#!/usr/bin/env tsx
/**
 * CLI: pull from SimpleFIN and run detection. Reads .env.local / .env via tsx.
 *   npm run sync
 */
import { runSync } from "../lib/sync";

(async () => {
  const r = await runSync();
  if (r.ok) {
    console.log(
      `OK in ${r.durationMs}ms — ${r.transactionsAdded} new txns across ${r.accountsUpdated} accounts; subs detected ${r.subscriptionsDetected}, updated ${r.subscriptionsUpdated}`,
    );
    if (r.errors.length) console.warn("warnings:", r.errors);
    process.exit(0);
  } else {
    console.error("Sync failed:", r.errors);
    process.exit(1);
  }
})();
