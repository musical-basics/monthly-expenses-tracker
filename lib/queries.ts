import { getDb } from "./db";

export type Subscription = {
  id: number;
  merchant_key: string;
  merchant_display: string;
  cadence: string;
  interval_days_median: number | null;
  latest_amount_cents: number | null;
  first_charged_at: number | null;
  last_charged_at: number | null;
  predicted_next_at: number | null;
  charge_count: number;
  confidence: string;
  price_increase: number;
  prior_amount_cents: number | null;
  status: string;
  priority: string | null;
  owner: string | null;
  notes: string | null;
  cancellation_progress: string | null;
  check_up: number; // 1 = user wants to double-check this one (e.g. confirm a cancellation stuck)
  canceled_at: number | null; // set when status flips to canceled, cleared when it flips back
  last_detected_at: number;
  updated_at: number;
};

/** A bank account/card a subscription has been charged to. */
export type SubscriptionAccount = {
  account_id: string;
  org_name: string | null;
  name: string;
  charge_count: number;
  last_charged_at: number;
};

export type SubscriptionWithAccounts = Subscription & {
  // Most recently charged first — accounts[0] is the account that currently pays for it.
  accounts: SubscriptionAccount[];
};

export type SubscriptionUpdate = Partial<{
  status: Subscription["status"];
  priority: Subscription["priority"];
  owner: Subscription["owner"];
  notes: Subscription["notes"];
  cancellation_progress: Subscription["cancellation_progress"];
  merchant_display: Subscription["merchant_display"];
  check_up: boolean;
}>;

const ALLOWED_STATUS = new Set([
  "active",
  "review",
  "needs_cancellation",
  "canceled",
  "hidden",
  "unknown",
]);

const ALLOWED_PRIORITY = new Set(["high", "normal", "low"]);
const ALLOWED_OWNER = new Set(["personal", "business", "unknown"]);

export function listSubscriptions(opts: {
  status?: string;
  includeHidden?: boolean;
} = {}): Subscription[] {
  const db = getDb();
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (opts.status) {
    where.push("status = @status");
    params.status = opts.status;
  } else if (!opts.includeHidden) {
    where.push("status != 'hidden'");
  }
  const sql =
    "SELECT * FROM subscriptions" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY (status='review') DESC, (status='needs_cancellation') DESC, last_charged_at DESC NULLS LAST";
  return db.prepare(sql).all(params) as Subscription[];
}

export function getSubscription(id: number): Subscription | null {
  const db = getDb();
  return (db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(id) as Subscription) || null;
}

export function updateSubscription(id: number, patch: SubscriptionUpdate): Subscription | null {
  const db = getDb();
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };

  if (patch.status !== undefined) {
    if (!ALLOWED_STATUS.has(patch.status)) throw new Error(`Invalid status: ${patch.status}`);
    sets.push("status = @status");
    // Stamp the moment it was marked canceled (keep the original stamp if it already was).
    sets.push(
      "canceled_at = CASE WHEN @status = 'canceled' THEN (CASE WHEN status = 'canceled' THEN canceled_at ELSE @now END) ELSE NULL END",
    );
    params.status = patch.status;
  }
  if (patch.priority !== undefined) {
    if (patch.priority !== null && !ALLOWED_PRIORITY.has(patch.priority)) {
      throw new Error(`Invalid priority: ${patch.priority}`);
    }
    sets.push("priority = @priority");
    params.priority = patch.priority;
  }
  if (patch.owner !== undefined) {
    if (patch.owner !== null && !ALLOWED_OWNER.has(patch.owner)) {
      throw new Error(`Invalid owner: ${patch.owner}`);
    }
    sets.push("owner = @owner");
    params.owner = patch.owner;
  }
  if (patch.notes !== undefined) {
    sets.push("notes = @notes");
    params.notes = patch.notes;
  }
  if (patch.cancellation_progress !== undefined) {
    sets.push("cancellation_progress = @cancellation_progress");
    params.cancellation_progress = patch.cancellation_progress;
  }
  if (patch.merchant_display !== undefined) {
    sets.push("merchant_display = @merchant_display");
    params.merchant_display = patch.merchant_display;
  }
  if (patch.check_up !== undefined) {
    if (typeof patch.check_up !== "boolean") throw new Error("check_up must be a boolean");
    sets.push("check_up = @check_up");
    params.check_up = patch.check_up ? 1 : 0;
  }

  if (sets.length === 0) return getSubscription(id);

  const now = Date.now();
  sets.push("updated_at = @now");
  params.now = now;

  db.prepare(`UPDATE subscriptions SET ${sets.join(", ")} WHERE id = @id`).run(params);
  return getSubscription(id);
}

export function listUpcomingRenewals(windowDays = 14): Subscription[] {
  const db = getDb();
  const now = Date.now();
  const until = now + windowDays * 86_400_000;
  return db
    .prepare(
      `SELECT * FROM subscriptions
       WHERE status IN ('active','review','needs_cancellation')
         AND predicted_next_at IS NOT NULL
         AND predicted_next_at <= @until
       ORDER BY predicted_next_at ASC`,
    )
    .all({ until }) as Subscription[];
}

export function listNeedingReview(): Subscription[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM subscriptions
       WHERE status IN ('review','needs_cancellation','unknown') OR price_increase = 1 OR check_up = 1
       ORDER BY check_up DESC, (status='review') DESC, (status='needs_cancellation') DESC, last_charged_at DESC`,
    )
    .all() as Subscription[];
}

export function listTransactionsForMerchant(merchantKey: string, limit = 50) {
  const db = getDb();
  return db
    .prepare(
      `SELECT t.id, t.account_id, a.name AS account_name, t.posted_at, t.amount_cents,
              t.description, t.payee, t.memo, t.pending
       FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
       WHERE t.merchant_key = ?
       ORDER BY t.posted_at DESC LIMIT ?`,
    )
    .all(merchantKey, limit);
}

/** Attach the account(s) each subscription is charged to. Seeded items with no charges get []. */
export function withAccounts(subs: Subscription[]): SubscriptionWithAccounts[] {
  const rows = getDb()
    .prepare(
      `SELECT t.merchant_key, t.account_id, a.org_name, COALESCE(a.name, t.account_id) AS name,
              COUNT(*) AS charge_count, MAX(t.posted_at) AS last_charged_at
       FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
       WHERE t.amount_cents < 0
         AND t.merchant_key IN (SELECT merchant_key FROM subscriptions)
       GROUP BY t.merchant_key, t.account_id
       ORDER BY last_charged_at DESC`,
    )
    .all() as (SubscriptionAccount & { merchant_key: string })[];

  const byMerchant = new Map<string, SubscriptionAccount[]>();
  for (const { merchant_key, ...acct } of rows) {
    const list = byMerchant.get(merchant_key);
    if (list) list.push(acct);
    else byMerchant.set(merchant_key, [acct]);
  }
  return subs.map((s) => ({ ...s, accounts: byMerchant.get(s.merchant_key) ?? [] }));
}

export function lastSync() {
  const db = getDb();
  return (
    (db
      .prepare("SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 1")
      .get() as
      | {
          id: number;
          started_at: number;
          finished_at: number | null;
          status: string;
          transactions_added: number | null;
          subscriptions_detected: number | null;
          error_message: string | null;
        }
      | undefined) || null
  );
}

/** When transactions were last pulled successfully — "no charge since X" is only trustworthy up to here. */
export function lastSuccessfulSyncAt(): number | null {
  const row = getDb()
    .prepare(
      "SELECT MAX(COALESCE(finished_at, started_at)) AS at FROM sync_log WHERE status = 'success'",
    )
    .get() as { at: number | null };
  return row.at;
}
