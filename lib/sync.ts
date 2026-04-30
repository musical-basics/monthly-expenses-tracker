import { createHash } from "node:crypto";
import { getDb } from "./db";
import { fetchAccounts } from "./simplefin";
import { normalizeMerchant, parseAmountToCents } from "./merchant";
import { detectSubscriptions } from "./detect";

const DAY_MS = 86_400_000;

export type SyncResult = {
  ok: boolean;
  transactionsAdded: number;
  accountsUpdated: number;
  subscriptionsDetected: number;
  subscriptionsUpdated: number;
  errors: string[];
  durationMs: number;
};

function stableTxnId(opts: {
  given?: string;
  accountId: string;
  postedAt: number;
  amountCents: number;
  description: string;
}): string {
  if (opts.given && opts.given.trim()) return opts.given.trim();
  const h = createHash("sha256");
  h.update(`${opts.accountId}|${opts.postedAt}|${opts.amountCents}|${opts.description}`);
  return `hash:${h.digest("hex").slice(0, 32)}`;
}

export async function runSync(opts: { lookbackDays?: number } = {}): Promise<SyncResult> {
  const startedAt = Date.now();
  const lookbackDays =
    opts.lookbackDays ?? Number(process.env.SYNC_LOOKBACK_DAYS || 180);
  const startDate = new Date(startedAt - lookbackDays * DAY_MS);

  const db = getDb();
  const logRow = db
    .prepare("INSERT INTO sync_log (started_at, status) VALUES (?, 'running')")
    .run(startedAt);
  const logId = logRow.lastInsertRowid as number;

  const result: SyncResult = {
    ok: false,
    transactionsAdded: 0,
    accountsUpdated: 0,
    subscriptionsDetected: 0,
    subscriptionsUpdated: 0,
    errors: [],
    durationMs: 0,
  };

  try {
    const data = await fetchAccounts({ startDate, pending: true });
    if (data.errors?.length) result.errors.push(...data.errors);

    const upsertAccount = db.prepare(`
      INSERT INTO accounts (id, org_name, name, currency, balance, balance_date, last_synced_at)
      VALUES (@id, @org_name, @name, @currency, @balance, @balance_date, @synced)
      ON CONFLICT(id) DO UPDATE SET
        org_name = excluded.org_name,
        name = excluded.name,
        currency = excluded.currency,
        balance = excluded.balance,
        balance_date = excluded.balance_date,
        last_synced_at = excluded.last_synced_at
    `);

    const insertTxn = db.prepare(`
      INSERT INTO transactions (
        id, account_id, posted_at, amount_cents, description, payee, memo,
        pending, merchant_key, raw_json, created_at
      ) VALUES (
        @id, @account_id, @posted_at, @amount_cents, @description, @payee, @memo,
        @pending, @merchant_key, @raw_json, @created_at
      )
      ON CONFLICT(id) DO UPDATE SET
        amount_cents = excluded.amount_cents,
        description = excluded.description,
        payee = excluded.payee,
        memo = excluded.memo,
        pending = excluded.pending,
        merchant_key = excluded.merchant_key,
        raw_json = excluded.raw_json
    `);

    const tx = db.transaction(() => {
      for (const acct of data.accounts) {
        upsertAccount.run({
          id: acct.id,
          org_name: acct.org?.name || null,
          name: acct.name,
          currency: acct.currency,
          balance: acct.balance,
          balance_date: acct["balance-date"] * 1000,
          synced: startedAt,
        });
        result.accountsUpdated++;

        for (const t of acct.transactions || []) {
          const postedAt = (t.posted ?? 0) * 1000;
          const amountCents = parseAmountToCents(t.amount);
          const description = t.description || t.payee || t.memo || "";
          const { key } = normalizeMerchant(t.payee || t.description || t.memo || "");
          const id = stableTxnId({
            given: t.id,
            accountId: acct.id,
            postedAt,
            amountCents,
            description,
          });

          // Don't store the access URL anywhere; only the raw transaction body.
          const safeRaw = { ...t };
          const before = db.prepare("SELECT 1 FROM transactions WHERE id = ?").get(id);
          insertTxn.run({
            id,
            account_id: acct.id,
            posted_at: postedAt,
            amount_cents: amountCents,
            description,
            payee: t.payee || null,
            memo: t.memo || null,
            pending: t.pending ? 1 : 0,
            merchant_key: key,
            raw_json: JSON.stringify(safeRaw),
            created_at: startedAt,
          });
          if (!before) result.transactionsAdded++;
        }
      }
    });
    tx();

    const det = detectSubscriptions();
    result.subscriptionsDetected = det.detected;
    result.subscriptionsUpdated = det.updated;
    result.ok = true;

    db.prepare(
      `UPDATE sync_log SET finished_at = ?, status = 'success',
       transactions_added = ?, subscriptions_detected = ? WHERE id = ?`,
    ).run(Date.now(), result.transactionsAdded, result.subscriptionsDetected, logId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // NEVER include URLs/secrets in the error log
    result.errors.push(message);
    db.prepare(
      `UPDATE sync_log SET finished_at = ?, status = 'error', error_message = ? WHERE id = ?`,
    ).run(Date.now(), message, logId);
  }

  result.durationMs = Date.now() - startedAt;
  return result;
}
