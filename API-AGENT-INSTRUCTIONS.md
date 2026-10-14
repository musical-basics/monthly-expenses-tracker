# API Agent Access Instructions

This app exposes a bearer-protected JSON API for an automation agent such as Commander/OpenClaw. It tracks recurring subscription charges from SimpleFIN-backed transaction data stored in SQLite.

## Access Model

Run the Next.js app on the same VPS as the agent whenever possible.

Recommended local agent base URL:

```txt
http://localhost:3030
```

If the agent must connect over the network, put the app behind HTTPS with Caddy or another reverse proxy and use:

```txt
https://<protected-domain>
```

Do not expose the UI or API publicly without additional protection such as Caddy basic auth, Tailscale-only access, firewall rules, or equivalent network controls.

## Authentication

Every agent API request should include:

```txt
Authorization: Bearer <AGENT_API_TOKEN>
```

The token is configured on the app host via the `AGENT_API_TOKEN` environment variable. Do not print, log, paste, or store the token in conversation history.

Example:

```bash
curl -sS "$BASE_URL/api/subscriptions/review" \
  -H "Authorization: Bearer $AGENT_API_TOKEN"
```

Known note: `/api/docs` is currently reachable without auth, but agents should still send the bearer token on every `/api/*` request.

## Required App Runtime

The API is only available while the Next.js server is running.

Development:

```bash
npm run dev
```

Production:

```bash
npm run build
npm run start
```

Both `dev` and `start` run on port `3030` per `package.json`.

## Data Storage

The app uses SQLite by default:

```txt
data/subscriptions.db
```

Optional override:

```txt
DB_PATH=/path/to/subscriptions.db
```

SimpleFIN credentials must be configured on the app host with either `SIMPLEFIN_ACCESS_URL` or `SIMPLEFIN_SETUP_TOKEN`. Never send SimpleFIN credentials to the agent unless the agent is running on the trusted host and explicitly needs to manage server setup.

## Recommended Agent Loop

1. Sync latest transaction data:

```bash
curl -sS -X POST "$BASE_URL/api/sync" \
  -H "Authorization: Bearer $AGENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"lookbackDays":180}'
```

2. Fetch subscriptions needing attention:

```bash
curl -sS "$BASE_URL/api/subscriptions/review" \
  -H "Authorization: Bearer $AGENT_API_TOKEN"
```

3. Fetch upcoming renewals:

```bash
curl -sS "$BASE_URL/api/subscriptions/upcoming?window_days=7" \
  -H "Authorization: Bearer $AGENT_API_TOKEN"
```

4. Update subscription state after user-approved work:

```bash
curl -sS -X PATCH "$BASE_URL/api/subscriptions/<id>" \
  -H "Authorization: Bearer $AGENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "canceled",
    "cancellation_progress": "User confirmed cancellation on 2026-05-04"
  }'
```

## Endpoint Reference

### `POST /api/sync`

Pulls SimpleFIN transactions and re-runs subscription detection.

Optional JSON body:

```json
{
  "lookbackDays": 180
}
```

`lookbackDays` is clamped to `1` through `730`.

Returns:

```txt
{ ok, transactionsAdded, accountsUpdated, subscriptionsDetected, subscriptionsUpdated, errors[], durationMs }
```

### `GET /api/subscriptions`

Lists subscriptions.

Optional query params:

```txt
status=<active|review|needs_cancellation|canceled|hidden|unknown>
include_hidden=true
```

Returns:

```txt
{ count, last_sync, subscriptions[] }
```

Each subscription includes `accounts[]`: the bank accounts/cards it has been charged to, most recently charged first (`{ account_id, org_name, name, charge_count, last_charged_at }`). `accounts[0]` is the account currently paying for it. Seeded items with no charges have an empty array.

### `GET /api/subscriptions/:id`

Fetches one subscription plus recent transactions for its merchant. Each transaction includes `account_name`.

Returns:

```txt
{ subscription, transactions[] }
```

### `PATCH /api/subscriptions/:id`

Updates user-managed subscription fields.

Allowed JSON body fields:

```json
{
  "status": "active | review | needs_cancellation | canceled | hidden | unknown",
  "priority": "high | normal | low | null",
  "owner": "personal | business | unknown | null",
  "notes": "string | null",
  "cancellation_progress": "string | null",
  "merchant_display": "string",
  "check_up": "boolean"
}
```

`check_up` flags a subscription to double-check later (for example, confirming a cancellation actually went through). It is independent of `status`, so an item can be `canceled` and `check_up: true` at the same time.

Setting `status` to `canceled` stamps `canceled_at` with the current time (an existing stamp is kept if it was already canceled). Any other status clears `canceled_at`.

Returns:

```txt
{ subscription }
```

### `GET /api/subscriptions/review`

Lists subscriptions that need attention. Includes `review`, `needs_cancellation`, `unknown`, price-increase, and `check_up` items. Includes `accounts[]` like the list endpoint.

Returns:

```txt
{ count, subscriptions[] }
```

### `GET /api/subscriptions/upcoming`

Lists predicted renewals within a time window.

Optional query params:

```txt
window_days=7
```

`window_days` is clamped to `1` through `180`.

Returns:

```txt
{ window_days, count, subscriptions[] }
```

### `GET /api/seed`

Shows the built-in Commander seed list without applying it.

Returns:

```txt
{ items[] }
```

### `POST /api/seed`

Applies the built-in Commander seed list. Safe to run repeatedly.

Returns:

```txt
{ inserted, updated }
```

### `GET /api/docs`

Returns machine-readable endpoint documentation.

## Status Values

Use these exact subscription status values:

```txt
active
review
needs_cancellation
canceled
hidden
unknown
```

Recommended meanings:

- `active`: subscription appears active and does not currently need action.
- `review`: user or agent should investigate.
- `needs_cancellation`: user wants this canceled or worked.
- `canceled`: user confirms it is canceled.
- `hidden`: false positive or intentionally ignored.
- `unknown`: not enough information yet.

The separate `check_up` flag means "double-check this one." If a `canceled` + `check_up` subscription has `last_charged_at` later than `canceled_at`, the cancellation probably didn't stick, so tell the user. Clear the flag with `{ "check_up": false }` only after the user confirms it's resolved.

## Safety Rules For Agents

- Always ask for user confirmation before marking something `canceled` unless the user already gave explicit confirmation.
- Never claim that a service has been canceled unless cancellation was completed outside this tracker.
- This API does not cancel bank charges or subscriptions; it only tracks state and notes.
- Do not expose account numbers, raw credentials, bearer tokens, or SimpleFIN URLs.
- Treat transaction and subscription data as private financial data.
- Prefer `PATCH /api/subscriptions/:id` for state changes instead of editing SQLite directly.
- Use `POST /api/sync` at the start of a session or on a schedule, but avoid repeated sync loops unless the user asks.

## Cron Sync Example

For a VPS deployment, a simple recurring sync can run every 6 hours:

```cron
0 */6 * * * cd /path/to/monthly-expenses-tracker && npm run sync
```

The agent can then read from the already-current local API without triggering sync every time.
