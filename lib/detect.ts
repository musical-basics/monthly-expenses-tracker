import { getDb } from "./db";

export type Cadence = "weekly" | "monthly" | "quarterly" | "annual" | "irregular";
export type Confidence = "high" | "medium" | "low";

const DAY_MS = 86_400_000;

type TxnRow = {
  id: string;
  posted_at: number;
  amount_cents: number;
  merchant_key: string;
};

type Group = {
  merchantKey: string;
  merchantDisplay: string;
  txns: TxnRow[];
};

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function classifyCadence(intervalDays: number): Cadence {
  if (intervalDays >= 5 && intervalDays <= 9) return "weekly";
  if (intervalDays >= 25 && intervalDays <= 35) return "monthly";
  if (intervalDays >= 80 && intervalDays <= 100) return "quarterly";
  if (intervalDays >= 350 && intervalDays <= 380) return "annual";
  return "irregular";
}

function scoreConfidence(opts: {
  count: number;
  intervalCv: number; // coefficient of variation on intervals
  amountCv: number;
  cadence: Cadence;
}): Confidence {
  const { count, intervalCv, amountCv, cadence } = opts;
  if (cadence === "irregular") {
    if (count >= 6 && amountCv < 0.05) return "medium";
    return "low";
  }
  if (count >= 4 && intervalCv < 0.15 && amountCv < 0.1) return "high";
  if (count >= 3 && intervalCv < 0.3 && amountCv < 0.2) return "medium";
  return "low";
}

function cv(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean === 0) return 0;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

/**
 * Run detection over all stored transactions and upsert into `subscriptions`.
 * Preserves user-set status/notes/priority/owner/cancellation_progress when updating.
 */
export function detectSubscriptions(): { detected: number; updated: number } {
  const db = getDb();
  const now = Date.now();

  // Only consider debits (money out). SimpleFIN debits are negative.
  const rows = db
    .prepare(
      `SELECT id, posted_at, amount_cents, merchant_key
       FROM transactions
       WHERE amount_cents < 0 AND pending = 0
       ORDER BY posted_at ASC`,
    )
    .all() as TxnRow[];

  // Display name lookup — pick the most recent payee/description for each key
  const displayLookup = new Map<string, string>();
  const displayRows = db
    .prepare(
      `SELECT merchant_key, COALESCE(NULLIF(payee,''), NULLIF(description,''), 'Unknown') AS display
       FROM transactions
       WHERE id IN (
         SELECT id FROM transactions t1
         WHERE t1.posted_at = (SELECT MAX(posted_at) FROM transactions t2 WHERE t2.merchant_key = t1.merchant_key)
       )`,
    )
    .all() as { merchant_key: string; display: string }[];
  for (const r of displayRows) displayLookup.set(r.merchant_key, r.display);

  const groups = new Map<string, Group>();
  for (const t of rows) {
    let g = groups.get(t.merchant_key);
    if (!g) {
      g = {
        merchantKey: t.merchant_key,
        merchantDisplay: displayLookup.get(t.merchant_key) || t.merchant_key,
        txns: [],
      };
      groups.set(t.merchant_key, g);
    }
    g.txns.push(t);
  }

  let detected = 0;
  let updated = 0;

  const upsert = db.prepare(`
    INSERT INTO subscriptions (
      merchant_key, merchant_display, cadence, interval_days_median,
      latest_amount_cents, first_charged_at, last_charged_at, predicted_next_at,
      charge_count, confidence, price_increase, prior_amount_cents,
      status, last_detected_at, updated_at
    ) VALUES (
      @merchant_key, @merchant_display, @cadence, @interval_days_median,
      @latest_amount_cents, @first_charged_at, @last_charged_at, @predicted_next_at,
      @charge_count, @confidence, @price_increase, @prior_amount_cents,
      'active', @now, @now
    )
    ON CONFLICT(merchant_key) DO UPDATE SET
      merchant_display = excluded.merchant_display,
      cadence = excluded.cadence,
      interval_days_median = excluded.interval_days_median,
      latest_amount_cents = excluded.latest_amount_cents,
      first_charged_at = excluded.first_charged_at,
      last_charged_at = excluded.last_charged_at,
      predicted_next_at = excluded.predicted_next_at,
      charge_count = excluded.charge_count,
      confidence = excluded.confidence,
      price_increase = excluded.price_increase,
      prior_amount_cents = excluded.prior_amount_cents,
      last_detected_at = excluded.last_detected_at,
      updated_at = excluded.updated_at
      -- intentionally NOT updating: status, notes, priority, owner, cancellation_progress
  `);

  const tx = db.transaction(() => {
    for (const g of groups.values()) {
      if (g.txns.length < 2) continue;

      const sorted = g.txns.sort((a, b) => a.posted_at - b.posted_at);
      const intervalsDays: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        intervalsDays.push((sorted[i].posted_at - sorted[i - 1].posted_at) / DAY_MS);
      }
      const medInterval = median(intervalsDays);
      const cadence = classifyCadence(medInterval);

      const amounts = sorted.map((t) => Math.abs(t.amount_cents));
      const amountCv = cv(amounts);
      const intervalCv = cv(intervalsDays);
      const confidence = scoreConfidence({
        count: sorted.length,
        intervalCv,
        amountCv,
        cadence,
      });

      // Skip very-low confidence noise — but keep low-confidence monthly+ candidates
      // so the user can manually classify them
      if (confidence === "low" && cadence === "irregular" && sorted.length < 4) continue;

      const latest = sorted[sorted.length - 1];
      const prior = sorted[sorted.length - 2];
      const latestAmt = Math.abs(latest.amount_cents);
      const priorAmt = prior ? Math.abs(prior.amount_cents) : null;
      const priceIncrease =
        priorAmt !== null && latestAmt > priorAmt && (latestAmt - priorAmt) / priorAmt > 0.1;

      const predictedNext =
        cadence === "irregular" || medInterval === 0
          ? null
          : latest.posted_at + Math.round(medInterval) * DAY_MS;

      const result = upsert.run({
        merchant_key: g.merchantKey,
        merchant_display: g.merchantDisplay,
        cadence,
        interval_days_median: Number.isFinite(medInterval) ? medInterval : null,
        latest_amount_cents: -latestAmt,
        first_charged_at: sorted[0].posted_at,
        last_charged_at: latest.posted_at,
        predicted_next_at: predictedNext,
        charge_count: sorted.length,
        confidence,
        price_increase: priceIncrease ? 1 : 0,
        prior_amount_cents: priorAmt !== null ? -priorAmt : null,
        now,
      });
      if (result.changes > 0) {
        if ((result as unknown as { lastInsertRowid: number }).lastInsertRowid) detected++;
        else updated++;
      }
    }
  });
  tx();

  // Auto-flag price increases for review if user hasn't already triaged
  db.prepare(
    `UPDATE subscriptions
     SET status = 'review', updated_at = ?
     WHERE price_increase = 1 AND status = 'active'`,
  ).run(now);

  return { detected, updated };
}
