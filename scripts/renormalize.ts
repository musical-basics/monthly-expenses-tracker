#!/usr/bin/env tsx
/**
 * Re-applies normalizeMerchant() to every stored transaction. Use after
 * tweaking the merchant normalization rules so old transactions get
 * re-grouped under the new keys.
 *
 * Drops all subscription rows whose merchant_key no longer matches any
 * transaction (orphans from the old normalization), then re-runs detection.
 *
 *   npm run renormalize
 */
import { getDb } from "../lib/db";
import { normalizeMerchant } from "../lib/merchant";
import { detectSubscriptions } from "../lib/detect";

const db = getDb();
const txns = db
  .prepare("SELECT id, payee, description, memo, merchant_key FROM transactions")
  .all() as {
  id: string;
  payee: string | null;
  description: string | null;
  memo: string | null;
  merchant_key: string;
}[];

const update = db.prepare("UPDATE transactions SET merchant_key = ? WHERE id = ?");
let changed = 0;

const tx = db.transaction(() => {
  for (const t of txns) {
    const { key } = normalizeMerchant(t.payee || t.description || t.memo || "");
    if (key !== t.merchant_key) {
      update.run(key, t.id);
      changed++;
    }
  }
});
tx();

console.log(`Re-normalized ${changed} of ${txns.length} transactions`);

// Drop subscriptions that are now stale:
//   - merchant_key no longer appears in transactions, OR
//   - merchant_key has zero debits (only credits/income — e.g. Distrokid royalty
//     payouts that got re-grouped away from the actual subscription charges)
// In both cases, only drop if the user hasn't triaged it (no notes, no
// cancellation_progress, status is still default 'active') so we don't wipe
// seeded/triaged items.
const stale = db
  .prepare(
    `DELETE FROM subscriptions
     WHERE (
       merchant_key NOT IN (SELECT DISTINCT merchant_key FROM transactions)
       OR merchant_key NOT IN (
         SELECT DISTINCT merchant_key FROM transactions WHERE amount_cents < 0
       )
     )
       AND (notes IS NULL OR notes = '')
       AND (cancellation_progress IS NULL OR cancellation_progress = '')
       AND status = 'active'`,
  )
  .run();
console.log(`Dropped ${stale.changes} stale subscription rows`);

const det = detectSubscriptions();
console.log(`Detection: ${det.detected} new, ${det.updated} updated`);
