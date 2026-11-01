# Deployment guide

## 1. Pakistan VPS

The backend must run on a server **physically in Pakistan** on a normal Pakistani ISP network. A server elsewhere will report what that country sees, not Pakistan.

Minimum: 1 vCPU, 1 GB RAM, Ubuntu 22.04/24.04, a public IPv4, a domain pointing to it (for HTTPS).

Pick a provider whose upstream is a common consumer ISP (PTCL, Nayatel, Jazz, etc.). Note the ISP name and ASN; you'll put them in `.env`. Check the ASN with:

```bash
curl -s https://ipinfo.io/org
```

Use the ISP's default resolver (what `/etc/resolv.conf` gives you) so DNS-level blocking is visible. Don't point it at 1.1.1.1 or 8.8.8.8; those are only used as the independent DoH control.

## 2. Install

```bash
sudo apt update && sudo apt install -y git curl caddy
```

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
```

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin pkaf
```

```bash
sudo -u pkaf git clone <your-repo-url> /home/pkaf/app
```

```bash
cd /home/pkaf/app/backend && sudo -u pkaf npm ci && sudo -u pkaf npm run build
```

```bash
sudo -u pkaf cp .env.example .env && sudo -u pkaf nano .env
```

Set at least `PROBE_ISP`, `PROBE_ASN`, `PROBE_CITY`, `HOST=127.0.0.1`, `TRUST_PROXY=true`.

## 3. Database (optional but recommended)

Without `DATABASE_URL` the service still works (in-memory cache only). With it, every check, its evidence and the raw network measurement are stored for auditing and re-classification.

Supabase or any Postgres 14+ works:

```
DATABASE_URL=postgresql://user:password@host:5432/db?sslmode=require
```

Migrations run on boot. To run them by hand:

```bash
cd /home/pkaf/app/backend && sudo -u pkaf npm run migrate
```

Rows older than `RETENTION_DAYS` (default 30) are pruned every 6 hours.

## 4. systemd service

`/etc/systemd/system/pkaf.service`:

```ini
[Unit]
Description=PK Access Filter API
After=network-online.target
Wants=network-online.target

[Service]
User=pkaf
WorkingDirectory=/home/pkaf/app/backend
ExecStart=/usr/bin/node --env-file=.env dist/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now pkaf && sudo systemctl status pkaf
```

## 5. HTTPS with Caddy

`/etc/caddy/Caddyfile`:

```
pk-probe.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

```bash
sudo systemctl reload caddy
```

Caddy gets and renews the TLS certificate automatically. Open only ports 80 and 443:

```bash
sudo ufw allow 22,80,443/tcp && sudo ufw enable
```

Smoke test:

```bash
curl -s https://pk-probe.example.com/api/v1/status
```

```bash
curl -s -X POST https://pk-probe.example.com/api/v1/check -H 'content-type: application/json' -d '{"domains":["dawn.com"],"country":"PK"}'
```

## 6. Build and publish the extension

```bash
cd extension && npm ci && API_URL=https://pk-probe.example.com npm run package
```

This produces `extension/pk-access-filter.zip` with the API host baked into `host_permissions`. Upload it in the Chrome Web Store developer dashboard. For the listing:

- Single purpose: show Pakistan accessibility of Google Search results.
- Permissions: `storage` (settings + cache), host permission for your API only.
- Data use: only result domain names are sent to your server; no queries, URLs, history or personal data.

## 7. More ISPs

One VPS represents one network. To cover more ISPs, run the same backend on VPSes in other Pakistani networks and either:

- give each its own hostname and build separate extension variants, or
- put a small fan-out endpoint in front that calls each probe and merges results (store each probe's `network_measurements` row; the schema already keys by ISP/ASN).

OONI data already includes per-ASN counts (`networks` in the OONI summary), so blocking seen on other ISPs still shows up as evidence.

## 8. Operations

- Logs: `journalctl -u pkaf -f`
- Update: `git pull && npm ci && npm run build && sudo systemctl restart pkaf`
- Tune `CHECK_CONCURRENCY` (default 6) and `RATE_LIMIT_PER_MINUTE` (default 60) to the VPS size.
- If the extension shows "Checking service unreachable", it backs off exponentially (5 s up to 5 min). "Refresh measurements" in the popup resets it.
