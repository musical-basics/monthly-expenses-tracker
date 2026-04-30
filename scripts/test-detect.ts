#!/usr/bin/env tsx
/**
 * Synthetic-data smoke test for the detector. Wipes & re-seeds a tmp DB,
 * inserts a few merchants with known patterns, runs detection, prints results.
 *
 * Run: DB_PATH=./data/test.db tsx scripts/test-detect.ts
 */
import { unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// IMPORTANT: invoke with `DB_PATH=./data/test-detect.db tsx scripts/test-detect.ts`
// (ESM hoists imports, so we cannot set DB_PATH at runtime before importing db.ts)
const TEST_DB =
  process.env.DB_PATH || resolve(process.cwd(), "data/test-detect.db");
if (existsSync(TEST_DB)) unlinkSync(TEST_DB);

import { getDb } from "../lib/db";
import { detectSubscriptions } from "../lib/detect";
import { normalizeMerchant } from "../lib/merchant";

const db = getDb();
db.prepare(
  `INSERT INTO accounts (id, org_name, name, currency, balance, balance_date, last_synced_at)
   VALUES ('acct1','Test','Checking','USD','0',?,?)`,
).run(Date.now(), Date.now());

const insertTxn = db.prepare(`
  INSERT INTO transactions (id, account_id, posted_at, amount_cents, description, payee, memo, pending, merchant_key, raw_json, created_at)
  VALUES (@id, 'acct1', @posted_at, @amount_cents, @desc, @payee, NULL, 0, @merchant_key, '{}', @now)
`);

const now = Date.now();
const DAY = 86_400_000;

function add(merchant: string, daysAgoList: number[], amountsDollars: number[]) {
  const { key } = normalizeMerchant(merchant);
  daysAgoList.forEach((daysAgo, i) => {
    const amt = amountsDollars[i] ?? amountsDollars[amountsDollars.length - 1];
    insertTxn.run({
      id: `${key}-${i}`,
      posted_at: now - daysAgo * DAY,
      amount_cents: -Math.round(amt * 100),
      desc: merchant,
      payee: merchant,
      merchant_key: key,
      now,
    });
  });
}

// Clean monthly Netflix
add("Netflix", [120, 90, 60, 30, 0], [15.99, 15.99, 15.99, 15.99, 15.99]);
// Annual Adobe with price increase on latest
add("Adobe", [365, 0], [240.0, 280.0]);
// Weekly coffee (low confidence-ish, but should detect)
add("Blue Bottle Coffee", [28, 21, 14, 7, 0], [5.5, 5.5, 5.75, 5.5, 5.5]);
// One-off (not a subscription)
add("Random Hardware Store", [10], [42.99]);
// Irregular pattern, 3 charges
add("Gas Station X", [40, 25, 5], [55, 60, 58]);

const result = detectSubscriptions();
console.log("detect result:", result);

const subs = db
  .prepare(
    "SELECT merchant_display, cadence, confidence, charge_count, latest_amount_cents, prior_amount_cents, price_increase, status FROM subscriptions ORDER BY merchant_display",
  )
  .all();
console.table(subs);

unlinkSync(TEST_DB);
console.log("OK");
