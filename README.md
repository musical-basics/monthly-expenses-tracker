# Subscriptions Tracker

A SimpleFIN-powered subscriptions tracker for **Lionel** and **Commander** (Lionel's openclaw bot agent). Pulls bank/card transactions from SimpleFIN, detects recurring charges, and exposes both a UI and a JSON API so Commander can keep Lionel's subscription cleanup queue current over time.

> **Privacy note**: this app handles your bank data. It is built to run **locally** (or on a private server you control). Do not deploy it to a public URL without putting it behind your own auth + network controls. The `.env` is the only place secrets live.

---

## What it does

1. **Connect to SimpleFIN** — uses an access URL or one-time setup token. Setup token is claimed once and the resulting access URL is cached in `data/.access_url` (chmod 600).
2. **Import transactions** — pulls the last N days (default 180) on each sync. Deduplicates by SimpleFIN transaction id, or a stable hash if missing.
3. **Detect subscriptions** — groups transactions by normalized merchant, computes median interval, classifies cadence (weekly / monthly / quarterly / annual / irregular), assigns confidence (high / medium / low), and flags price increases.
4. **Track + edit** — UI table grouped by status, with inline edit for status, priority, notes, and cancellation progress.
5. **Commander API** — bearer-protected JSON endpoints for list, review, upcoming, and update.

---

## Quick start

```bash
cp .env.example .env
# edit .env: paste either SIMPLEFIN_ACCESS_URL or SIMPLEFIN_SETUP_TOKEN,
# and set AGENT_API_TOKEN to a long random string

npm install
npm run seed     # load Commander's known items (Higgsfield, Ollama, ...)
npm run sync     # first SimpleFIN pull + detection
npm run dev      # http://localhost:3030
```

UI lives at `http://localhost:3030/`.
Agent docs (human-readable) at `/agent-docs`.
Agent docs (JSON) at `/api/docs`.

---

## SimpleFIN setup (one-time)

1. Sign up at <https://beta-bridge.simplefin.org/>, link your accounts.
2. Generate a **setup token** (long base64 string).
3. Either:
   - Put it in `.env` as `SIMPLEFIN_SETUP_TOKEN=...` — the app claims it on first sync and writes the resulting access URL to `data/.access_url`. **The setup token burns on claim**, so this only works once.
   - Or, claim it yourself (`curl -X POST $(echo "$TOKEN" | base64 -d)`) and put the resulting URL in `SIMPLEFIN_ACCESS_URL=https://user:pass@...`.

The access URL contains your credentials. **Never commit it.** `.gitignore` already excludes `.env`, `data/`, and `*.db`.

---

## How Commander uses it

Commander makes HTTPS requests to the local server with `Authorization: Bearer <AGENT_API_TOKEN>`.

**Recommended session loop:**

1. `POST /api/sync` — pull latest, re-detect.
2. `GET /api/subscriptions/review` — what needs Lionel's attention.
3. `GET /api/subscriptions/upcoming?window_days=7` — this week's renewals.
4. As Commander helps Lionel work cancellations:
   `PATCH /api/subscriptions/:id` with `{ status: "canceled", cancellation_progress: "emailed support 2026-04-30" }`.
5. For false positives (one-time charges that look recurring):
   `PATCH /api/subscriptions/:id` with `{ status: "hidden" }`.

Full schema at `GET /api/docs`. See `app/agent-docs/page.tsx` for the human-readable version.

### Example call

```bash
curl -s http://localhost:3030/api/subscriptions/review \
  -H "Authorization: Bearer $AGENT_API_TOKEN" | jq
```

---

## Commander's seed list

Pre-loaded by `npm run seed` (or POST `/api/seed`):

| Merchant     | Status                 | Priority | Notes                                                    |
|--------------|------------------------|----------|----------------------------------------------------------|
| Higgsfield   | `canceled`             |          | Cancelled — keep for history.                            |
| Ollama       | `needs_cancellation`   | normal   | Cancel — not in active use.                              |
| zBackup      | `needs_cancellation`   | low      | Heavy cancellation flow, defer until focused session.    |
| Teachable    | `needs_cancellation`   | low      | Heavy cancellation flow, defer until focused session.    |
| BetterHelp   | `canceled`             |          | Reviewed and cancelled.                                  |
| Verizon      | `review`               | high     | Investigate price increase.                              |

Re-running the seed is **safe**: it preserves any user edits that weren't overridden by the seed.

---

## Architecture

```
.env                       # secrets (SimpleFIN URL/token, AGENT_API_TOKEN)
data/                      # gitignored — SQLite DB + cached access URL
  subscriptions.db
  .access_url              # 0600
lib/
  db.ts                    # SQLite, migrations
  simplefin.ts             # SimpleFIN client (claim setup token, fetch /accounts)
  merchant.ts              # payee normalization
  detect.ts                # cadence + confidence detection, upsert
  sync.ts                  # full sync pipeline
  queries.ts               # subscription read/update
  seed.ts                  # Commander's known items
  auth.ts                  # bearer token gate, account-number redaction
  format.ts                # display formatting
app/
  page.tsx                 # main UI
  components/              # SubscriptionRow, SyncButton, SeedButton
  actions.ts               # server actions for in-page mutations (no token in browser)
  agent-docs/page.tsx      # human-readable docs
  api/
    sync/                  # POST sync
    subscriptions/         # GET list, GET/PATCH :id, GET upcoming, GET review
    seed/                  # POST/GET seed
    docs/                  # GET JSON docs
scripts/
  sync.ts                  # CLI: tsx scripts/sync.ts
  seed.ts                  # CLI: tsx scripts/seed.ts
```

### Detection algorithm

For each merchant key (after normalization):

- Sort debits by `posted_at`, compute pairwise interval days.
- Classify the **median interval**: weekly (5–9), monthly (25–35), quarterly (80–100), annual (350–380), else irregular.
- **Confidence:**
  - `high`  — ≥4 charges, interval CV <0.15, amount CV <0.10
  - `medium` — ≥3 charges, interval CV <0.30, amount CV <0.20
  - `low`   — everything else (kept around so you can manually triage)
- **Price increase** — latest charge >10% above prior. Auto-flips status to `review` (only if currently `active`).

The detection upsert **never overwrites** user-set fields: `status`, `notes`, `priority`, `owner`, `cancellation_progress`. So manual triage decisions survive future syncs.

---

## Safety

- Bearer token (`AGENT_API_TOKEN`) required on every `/api/*` route. Tokens shorter than 16 chars are rejected as misconfigured.
- SimpleFIN credentials live only in `.env` and `data/.access_url` (chmod 600). Never logged. Never in error messages.
- Account numbers redacted (any 4+ digit run → `XXXX`) when surfaced via `auth.redactAccount`.
- The app **does not move money or call the bank to cancel anything** — it tracks and advises. All real cancellations happen out-of-band by Lionel/Commander.

---

## Scripts

```bash
npm run dev        # Next dev server on :3030
npm run build      # production build
npm run start      # production server on :3030
npm run sync       # one-shot SimpleFIN pull + detection (CLI)
npm run seed       # apply Commander's seed list (CLI)
npm run typecheck  # tsc --noEmit
```

Want a recurring sync? `crontab -e` with `0 7 * * * cd /path/to/repo && npm run sync` will run it every morning at 7am.
