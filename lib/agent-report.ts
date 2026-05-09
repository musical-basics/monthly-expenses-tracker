import { getDb } from "./db";

export type DailyReportItem = {
  transaction_id: string;
  posted_at: number;
  merchant_key: string;
  merchant_display: string;
  amount_cents: number;
  classification: string;
  subscription_status: string | null;
  reason_codes: string[];
};

export type DailyReport = {
  date: string;
  timezone: string;
  transaction_count: number;
  total_debits_cents: number;
  total_credits_cents: number;
  attention_count: number;
  items: DailyReportItem[];
  generated_at: number;
  delivery?: DailyReportDelivery | null;
};

export type DailyReportDelivery = {
  report_date: string;
  generated_at: number | null;
  delivered_at: number | null;
  delivery_status: string;
  delivery_channel: string | null;
  delivery_notes: string | null;
  report_json: string | null;
  updated_at: number;
};

const DAY_MS = 86_400_000;
const DEFAULT_TZ = "America/New_York";
const ALERT_THRESHOLD_CENTS = 10_000;
const ATTENTION_STATUSES = new Set(["review", "needs_cancellation", "unknown"]);

function dayBoundsUtcMs(date: string, timeZone = DEFAULT_TZ) {
  // This app currently runs in Commander’s environment, where America/New_York
  // is the reporting timezone. Use Intl to avoid returning raw account data.
  const [year, month, day] = date.split("-").map(Number);
  const utcNoon = Date.UTC(year, month - 1, day, 12, 0, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .formatToParts(new Date(utcNoon))
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offset = localAsUtc - utcNoon;
  const start = Date.UTC(year, month - 1, day, 0, 0, 0) - offset;
  return { start, end: start + DAY_MS };
}

function classify(subscriptionStatus: string | null): string {
  if (subscriptionStatus === "needs_cancellation") return "to_cancel";
  if (subscriptionStatus === "hidden") return "false_positive";
  if (subscriptionStatus === "active") return "approved_subscription";
  if (subscriptionStatus === "review" || subscriptionStatus === "unknown") return "needs_review";
  return "unknown";
}

export function ensureAgentReportSchema() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS agent_daily_reports (
      report_date TEXT PRIMARY KEY,
      timezone TEXT NOT NULL DEFAULT 'America/New_York',
      generated_at INTEGER,
      delivered_at INTEGER,
      delivery_status TEXT NOT NULL DEFAULT 'generated',
      delivery_channel TEXT,
      delivery_notes TEXT,
      report_json TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
}

export function getDailyReport(date: string, opts: { timezone?: string; persist?: boolean } = {}): DailyReport {
  ensureAgentReportSchema();
  const timezone = opts.timezone || DEFAULT_TZ;
  const { start, end } = dayBoundsUtcMs(date, timezone);
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT t.id AS transaction_id, t.posted_at, t.amount_cents, t.merchant_key,
              COALESCE(s.merchant_display, t.payee, t.merchant_key) AS merchant_display,
              s.status AS subscription_status
       FROM transactions t
       LEFT JOIN subscriptions s ON s.merchant_key = t.merchant_key
       WHERE t.posted_at >= ? AND t.posted_at < ?
       ORDER BY t.posted_at ASC, t.amount_cents ASC`,
    )
    .all(start, end) as Array<{
    transaction_id: string;
    posted_at: number;
    amount_cents: number;
    merchant_key: string;
    merchant_display: string | null;
    subscription_status: string | null;
  }>;

  let totalDebits = 0;
  let totalCredits = 0;
  const items: DailyReportItem[] = [];

  for (const row of rows) {
    const amount = Number(row.amount_cents);
    if (amount < 0) totalDebits += Math.abs(amount);
    else totalCredits += amount;

    const status = row.subscription_status || null;
    const classification = classify(status);
    const reasonCodes: string[] = [];
    if (status && ATTENTION_STATUSES.has(status)) reasonCodes.push(`subscription_${status}`);
    if (!status) reasonCodes.push("no_subscription_match");
    if (Math.abs(amount) >= ALERT_THRESHOLD_CENTS) reasonCodes.push("amount_over_100");

    if (reasonCodes.length) {
      items.push({
        transaction_id: row.transaction_id,
        posted_at: row.posted_at,
        merchant_key: row.merchant_key,
        merchant_display: row.merchant_display || row.merchant_key,
        amount_cents: amount,
        classification,
        subscription_status: status,
        reason_codes: reasonCodes,
      });
    }
  }

  const report: DailyReport = {
    date,
    timezone,
    transaction_count: rows.length,
    total_debits_cents: totalDebits,
    total_credits_cents: totalCredits,
    attention_count: items.length,
    items,
    generated_at: Date.now(),
    delivery: getDailyReportDelivery(date),
  };

  if (opts.persist) recordDailyReportGenerated(report);
  return report;
}

export function recordDailyReportGenerated(report: DailyReport) {
  ensureAgentReportSchema();
  getDb()
    .prepare(
      `INSERT INTO agent_daily_reports
         (report_date, timezone, generated_at, delivery_status, report_json, updated_at)
       VALUES (@date, @timezone, @generated_at, 'generated', @report_json, @generated_at)
       ON CONFLICT(report_date) DO UPDATE SET
         timezone = excluded.timezone,
         generated_at = excluded.generated_at,
         report_json = excluded.report_json,
         delivery_status = CASE
           WHEN agent_daily_reports.delivered_at IS NULL THEN 'generated'
           ELSE agent_daily_reports.delivery_status
         END,
         updated_at = excluded.updated_at`,
    )
    .run({
      date: report.date,
      timezone: report.timezone,
      generated_at: report.generated_at,
      report_json: JSON.stringify({ ...report, delivery: undefined }),
    });
}

export function markDailyReportDelivered(date: string, patch: { channel?: string; notes?: string } = {}) {
  ensureAgentReportSchema();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO agent_daily_reports
         (report_date, generated_at, delivered_at, delivery_status, delivery_channel, delivery_notes, updated_at)
       VALUES (@date, @now, @now, 'delivered', @channel, @notes, @now)
       ON CONFLICT(report_date) DO UPDATE SET
         delivered_at = excluded.delivered_at,
         delivery_status = 'delivered',
         delivery_channel = excluded.delivery_channel,
         delivery_notes = excluded.delivery_notes,
         updated_at = excluded.updated_at`,
    )
    .run({ date, now, channel: patch.channel || null, notes: patch.notes || null });
  return getDailyReportDelivery(date);
}

export function getDailyReportDelivery(date: string): DailyReportDelivery | null {
  ensureAgentReportSchema();
  return (
    (getDb()
      .prepare("SELECT * FROM agent_daily_reports WHERE report_date = ?")
      .get(date) as DailyReportDelivery | undefined) || null
  );
}

export function listUndeliveredReports(limit = 7): DailyReportDelivery[] {
  ensureAgentReportSchema();
  return getDb()
    .prepare(
      `SELECT * FROM agent_daily_reports
       WHERE generated_at IS NOT NULL AND delivered_at IS NULL
       ORDER BY report_date ASC LIMIT ?`,
    )
    .all(limit) as DailyReportDelivery[];
}
