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
  last_detected_at: number;
  updated_at: number;
};

export type SubscriptionUpdate = Partial<{
  status: Subscription["status"];
  priority: Subscription["priority"];
  owner: Subscription["owner"];
  notes: Subscription["notes"];
  cancellation_progress: Subscription["cancellation_progress"];
  merchant_display: Subscription["merchant_display"];
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

  if (sets.length === 0) return getSubscription(id);

  sets.push("updated_at = @updated_at");
  params.updated_at = Date.now();

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
       WHERE status IN ('review','needs_cancellation','unknown') OR price_increase = 1
       ORDER BY (status='review') DESC, (status='needs_cancellation') DESC, last_charged_at DESC`,
    )
    .all() as Subscription[];
}

export function listTransactionsForMerchant(merchantKey: string, limit = 50) {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, account_id, posted_at, amount_cents, description, payee, memo, pending
       FROM transactions WHERE merchant_key = ?
       ORDER BY posted_at DESC LIMIT ?`,
    )
    .all(merchantKey, limit);
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
