# VPS Installation

This guide installs `monthly-expenses-tracker` on the same Hetzner VPS as the OpenClaw/Commander agent.

The preferred architecture is:

```txt
OpenClaw agent -> http://localhost:3030/api/... -> Next.js app -> SQLite
```

Only expose the browser UI over the network if it is protected with HTTPS plus auth or a private network such as Tailscale.

## 1. Prepare The VPS

Assumptions:

- Ubuntu/Debian VPS
- SSH access to the server
- A non-root user that will run the app, for example `openclaw`
- GitHub access to `https://github.com/musical-basics/monthly-expenses-tracker.git`

Install OS packages and Node.js 22:

```bash
sudo apt update
sudo apt install -y git curl build-essential python3 make g++ sqlite3

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

node -v
npm -v
```

`build-essential`, `python3`, `make`, and `g++` are needed because this app uses `better-sqlite3`.

## 2. Clone The Repo

Use `/opt/monthly-expenses-tracker` as the install path:

```bash
sudo mkdir -p /opt/monthly-expenses-tracker
sudo chown -R "$USER:$USER" /opt/monthly-expenses-tracker

git clone https://github.com/musical-basics/monthly-expenses-tracker.git /opt/monthly-expenses-tracker
cd /opt/monthly-expenses-tracker
```

If the repo is private, configure GitHub SSH access or a deploy key first, then clone with the SSH URL instead.

## 3. Configure Environment Variables

Create the app env file:

```bash
cd /opt/monthly-expenses-tracker
cp .env.example .env
nano .env
```

Required values:

```txt
AGENT_API_TOKEN=<long-random-token>
SIMPLEFIN_SETUP_TOKEN=<one-time-simplefin-setup-token>
```

Generate a strong API token:

```bash
openssl rand -hex 32
```

You can use either:

```txt
SIMPLEFIN_SETUP_TOKEN=<one-time-token>
```

or:

```txt
SIMPLEFIN_ACCESS_URL=<claimed-simplefin-access-url>
```

Important:

- Do not commit `.env`.
- Do not paste secrets into chat logs.
- Replace the placeholder `AGENT_API_TOKEN`.
- Configure exactly one SimpleFIN credential path.
- If using `SIMPLEFIN_SETUP_TOKEN`, remove or comment out the placeholder `SIMPLEFIN_ACCESS_URL` from `.env`.
- `SIMPLEFIN_SETUP_TOKEN` can only be claimed once.
- After first sync, the app stores the reusable access URL at `data/.access_url`.

Lock down local secret files:

```bash
chmod 600 .env
mkdir -p data
chmod 700 data
```

## 4. Install Dependencies

```bash
cd /opt/monthly-expenses-tracker
npm ci
```

## 5. Initialize Data

Apply the built-in Commander seed list:

```bash
npm run seed
```

Run the first SimpleFIN sync:

```bash
npm run sync
```

This creates or updates:

```txt
data/subscriptions.db
data/.access_url
```

## 6. Build The App

```bash
npm run build
```

## 7. Install A systemd Service

Create the service file:

```bash
sudo nano /etc/systemd/system/monthly-expenses-tracker.service
```

Paste this, replacing `openclaw` with the Linux user that owns the app files:

```ini
[Unit]
Description=Monthly Expenses Tracker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=openclaw
WorkingDirectory=/opt/monthly-expenses-tracker
Environment=NODE_ENV=production
EnvironmentFile=/opt/monthly-expenses-tracker/.env
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable monthly-expenses-tracker
sudo systemctl start monthly-expenses-tracker
sudo systemctl status monthly-expenses-tracker
```

View logs:

```bash
journalctl -u monthly-expenses-tracker -f
```

The app should now listen on:

```txt
http://localhost:3030
```

## 8. Smoke Test The API

From the VPS:

```bash
cd /opt/monthly-expenses-tracker
set -a
. ./.env
set +a

curl -sS "http://localhost:3030/api/subscriptions/review" \
  -H "Authorization: Bearer $AGENT_API_TOKEN"
```

Expected result:

```txt
{ "count": ..., "subscriptions": [...] }
```

Unauthorized requests should fail:

```bash
curl -i "http://localhost:3030/api/subscriptions/review"
```

Expected result:

```txt
HTTP/1.1 401 Unauthorized
```

## 9. Configure OpenClaw/Commander

Because the agent is on the same VPS, use the local API URL:

```txt
BASE_URL=http://localhost:3030
AGENT_API_TOKEN=<same token from /opt/monthly-expenses-tracker/.env>
```

Recommended agent workflow:

```txt
POST /api/sync
GET  /api/subscriptions/review
GET  /api/subscriptions/upcoming?window_days=7
PATCH /api/subscriptions/:id
```

See `API-AGENT-INSTRUCTIONS.md` for the full agent endpoint guide.

## 10. Optional HTTPS UI With Caddy

If you want browser access from your Mac, put Caddy in front of the app.

Install Caddy:

```bash
sudo apt install -y caddy
```

Generate a basic-auth password hash:

```bash
caddy hash-password
```

Edit Caddy:

```bash
sudo nano /etc/caddy/Caddyfile
```

Example:

```caddy
subs.example.com {
  basicauth {
    lionel <hashed-password-from-caddy>
  }

  reverse_proxy localhost:3030
}
```

Reload Caddy:

```bash
sudo systemctl reload caddy
```

The OpenClaw agent should still use `http://localhost:3030`, not the public HTTPS URL.

## 11. Recurring Sync

Option A: let the agent call `POST /api/sync` at the start of a session.

Option B: run a cron sync every 6 hours:

```bash
crontab -e
```

Add:

```cron
0 */6 * * * cd /opt/monthly-expenses-tracker && npm run sync >> /var/log/monthly-expenses-sync.log 2>&1
```

If cron cannot find `npm`, use the full path:

```cron
0 */6 * * * cd /opt/monthly-expenses-tracker && /usr/bin/npm run sync >> /var/log/monthly-expenses-sync.log 2>&1
```

## 12. Updates

To update the deployed app:

```bash
cd /opt/monthly-expenses-tracker
git pull
npm ci
npm run build
sudo systemctl restart monthly-expenses-tracker
```

Smoke test after updating:

```bash
curl -sS "http://localhost:3030/api/docs" \
  -H "Authorization: Bearer $AGENT_API_TOKEN"
```

## 13. Backups

Back up SQLite regularly:

```bash
mkdir -p ~/backups/monthly-expenses-tracker
sqlite3 /opt/monthly-expenses-tracker/data/subscriptions.db \
  ".backup '$HOME/backups/monthly-expenses-tracker/subscriptions-$(date +%F).db'"
```

Back up these files securely:

```txt
/opt/monthly-expenses-tracker/data/subscriptions.db
/opt/monthly-expenses-tracker/data/.access_url
/opt/monthly-expenses-tracker/.env
```

Treat all backups as private financial data.

## Troubleshooting

Check service logs:

```bash
journalctl -u monthly-expenses-tracker -n 100 --no-pager
```

Check the port:

```bash
ss -ltnp | grep 3030
```

Restart the service:

```bash
sudo systemctl restart monthly-expenses-tracker
```

Run a manual sync:

```bash
cd /opt/monthly-expenses-tracker
npm run sync
```

Common problems:

- `401 Unauthorized`: the bearer token is missing or does not match `AGENT_API_TOKEN`.
- `Server misconfigured`: `AGENT_API_TOKEN` is missing, too short, or still set to the placeholder.
- `No SimpleFIN credentials`: set `SIMPLEFIN_ACCESS_URL` or `SIMPLEFIN_SETUP_TOKEN`.
- Build errors involving `better-sqlite3`: install `build-essential`, `python3`, `make`, and `g++`, then rerun `npm ci`.
