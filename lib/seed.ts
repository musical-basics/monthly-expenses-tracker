import { getDb } from "./db";
import { normalizeMerchant } from "./merchant";

type SeedItem = {
  merchant: string;
  status: "active" | "review" | "needs_cancellation" | "canceled" | "hidden" | "unknown";
  priority?: "high" | "normal" | "low";
  notes: string;
  cancellationProgress?: string;
};

/**
 * Items Commander already knows about. Reconciled into the subscriptions table —
 * if the merchant is later detected from SimpleFIN, the user-set status / notes
 * here are preserved by the upsert logic in lib/detect.ts.
 */
export const COMMANDER_SEED: SeedItem[] = [
  {
    merchant: "Higgsfield",
    status: "canceled",
    notes: "Cancelled — keep in tracker for history.",
  },
  {
    merchant: "Ollama",
    status: "needs_cancellation",
    priority: "normal",
    notes: "Cancel — not in active use.",
  },
  {
    merchant: "zBackup",
    status: "needs_cancellation",
    priority: "low",
    notes: "Cancel — but cancellation flow is heavy, defer until a focused session.",
  },
  {
    merchant: "Teachable",
    status: "needs_cancellation",
    priority: "low",
    notes: "Cancel — but cancellation flow is heavy, defer until a focused session.",
  },
  {
    merchant: "BetterHelp",
    status: "canceled",
    notes: "Reviewed and cancelled.",
  },
  {
    merchant: "Verizon",
    status: "review",
    priority: "high",
    notes: "Investigate price increase — confirm new amount and whether plan can be downgraded.",
  },
];

export function applySeed(): { inserted: number; updated: number } {
  const db = getDb();
  const now = Date.now();
  let inserted = 0;
  let updated = 0;

  const insert = db.prepare(`
    INSERT INTO subscriptions (
      merchant_key, merchant_display, cadence, charge_count, confidence,
      status, priority, notes, last_detected_at, updated_at
    ) VALUES (
      @key, @display, 'irregular', 0, 'low',
      @status, @priority, @notes, @now, @now
    )
    ON CONFLICT(merchant_key) DO UPDATE SET
      status = excluded.status,
      priority = COALESCE(excluded.priority, subscriptions.priority),
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `);

  for (const item of COMMANDER_SEED) {
    const { key, display } = normalizeMerchant(item.merchant);
    const existed = db.prepare("SELECT 1 FROM subscriptions WHERE merchant_key = ?").get(key);
    insert.run({
      key,
      display: display || item.merchant,
      status: item.status,
      priority: item.priority || null,
      notes: item.notes,
      now,
    });
    if (existed) updated++;
    else inserted++;
  }

  return { inserted, updated };
}
