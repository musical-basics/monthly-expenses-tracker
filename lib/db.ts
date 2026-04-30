import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DB_PATH = process.env.DB_PATH || resolve(process.cwd(), "data/subscriptions.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  return _db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      org_name TEXT,
      name TEXT,
      currency TEXT,
      balance TEXT,
      balance_date INTEGER,
      last_synced_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      posted_at INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      description TEXT,
      payee TEXT,
      memo TEXT,
      pending INTEGER NOT NULL DEFAULT 0,
      merchant_key TEXT NOT NULL,
      raw_json TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON transactions(merchant_key);
    CREATE INDEX IF NOT EXISTS idx_transactions_posted ON transactions(posted_at);
    CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_key TEXT NOT NULL UNIQUE,
      merchant_display TEXT NOT NULL,
      cadence TEXT NOT NULL,            -- weekly | monthly | quarterly | annual | irregular
      interval_days_median REAL,
      latest_amount_cents INTEGER,
      first_charged_at INTEGER,
      last_charged_at INTEGER,
      predicted_next_at INTEGER,
      charge_count INTEGER NOT NULL DEFAULT 0,
      confidence TEXT NOT NULL,         -- high | medium | low
      price_increase INTEGER NOT NULL DEFAULT 0,
      prior_amount_cents INTEGER,
      status TEXT NOT NULL DEFAULT 'active',  -- active | review | needs_cancellation | canceled | hidden | unknown
      priority TEXT,                    -- high | normal | low
      owner TEXT,                       -- personal | business | unknown
      notes TEXT,
      cancellation_progress TEXT,
      last_detected_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_next ON subscriptions(predicted_next_at);

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      status TEXT NOT NULL,            -- running | success | error
      transactions_added INTEGER DEFAULT 0,
      subscriptions_detected INTEGER DEFAULT 0,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

export function metaGet(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function metaSet(key: string, value: string) {
  getDb()
    .prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}
