# HireOps — Native VPS Deploy (no Docker)

Deploy `hireops.symprio.com` alongside your existing `symprio.com` site on the same VPS, using the existing host nginx as the reverse proxy. Backend runs as a systemd service; frontend runs as a systemd service; Postgres runs natively.

**Target host:** `45.127.7.249` (port 8288, root)
**Domain:** `hireops.symprio.com`
**Ports (loopback only):** backend `127.0.0.1:8017`, frontend `127.0.0.1:3017`

The numbers `:8017/:3017` are arbitrary — picked to not collide with `:8000/:3000`/`:80/:443` already in use. nginx on the host proxies `hireops.symprio.com → :3017`/`/api/* → :8017`.

---

## 0. DNS (do first)

Add an A record at your DNS provider:

```
hireops.symprio.com.   A   45.127.7.249
```

Wait for propagation (`dig +short hireops.symprio.com` should return the IP) before running certbot in step 6.

---

## 1. SSH in and create the service user

```bash
ssh -p 8288 root@45.127.7.249

# Dedicated unprivileged user (no login shell)
useradd --system --create-home --home-dir /opt/hireops --shell /usr/sbin/nologin hireops || true
mkdir -p /opt/hireops /var/lib/hireops
chown -R hireops:hireops /opt/hireops /var/lib/hireops
```

---

## 2. System dependencies

```bash
apt update
apt install -y \
  python3.11 python3.11-venv python3.11-dev \
  build-essential libpq-dev \
  postgresql postgresql-contrib \
  nodejs npm \
  nginx certbot python3-certbot-nginx \
  git

# Verify versions
python3.11 --version   # >= 3.11
node --version         # >= 20 (if older, install via nodesource — see note)
```

**If `node --version` is older than 20:**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
```

---

## 3. Postgres database

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE hireops WITH LOGIN PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
CREATE DATABASE hireops OWNER hireops;
GRANT ALL PRIVILEGES ON DATABASE hireops TO hireops;
SQL
```

Test the connection:
```bash
PGPASSWORD='CHANGE_ME_STRONG_PASSWORD' psql -h 127.0.0.1 -U hireops -d hireops -c '\conninfo'
```

---

## 4. Clone + build the app

```bash
sudo -u hireops -H bash <<'EOSU'
cd /opt/hireops
git clone https://github.com/ddrdushy/mistral_hackathon_26.git .
EOSU

# Backend deps
sudo -u hireops -H bash <<'EOSU'
cd /opt/hireops/backend
python3.11 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
EOSU

# Backend env
cat > /opt/hireops/backend/.env <<'ENV'
# ── DB ───────────────────────────────────────────────
DATABASE_URL=postgresql+psycopg2://hireops:CHANGE_ME_STRONG_PASSWORD@127.0.0.1:5432/hireops

# ── Auth ─────────────────────────────────────────────
JWT_SECRET=REPLACE_WITH_64_HEX_CHARS_FROM_openssl_rand_-hex_32
SUPERADMIN_EMAILS=dushy2009@gmail.com

# ── LLM / voice ──────────────────────────────────────
MISTRAL_API_KEY=
ELEVENLABS_API_KEY=

# ── SMTP (use your existing postfix on the host) ─────
SMTP_HOST=127.0.0.1
SMTP_PORT=25
SMTP_FROM=no-reply@symprio.com

# ── Stripe (optional — fill if billing live) ─────────
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_STARTER=
STRIPE_PRICE_PRO=

# ── App ──────────────────────────────────────────────
FRONTEND_URL=https://hireops.symprio.com
ENV=production
SENTRY_DSN=
ENV
chown hireops:hireops /opt/hireops/backend/.env
chmod 600 /opt/hireops/backend/.env

# Generate a JWT secret and patch it in
JWT=$(openssl rand -hex 32)
sed -i "s/REPLACE_WITH_64_HEX_CHARS_FROM_openssl_rand_-hex_32/$JWT/" /opt/hireops/backend/.env

# Frontend build
sudo -u hireops -H bash <<'EOSU'
cd /opt/hireops/frontend
npm ci
EOSU

# Frontend env (NEXT_PUBLIC_* must be set BEFORE build — they're inlined)
cat > /opt/hireops/frontend/.env.production <<'ENV'
NEXT_PUBLIC_API_URL=https://hireops.symprio.com/api/v1
ENV
chown hireops:hireops /opt/hireops/frontend/.env.production

sudo -u hireops -H bash <<'EOSU'
cd /opt/hireops/frontend
npm run build
# Next.js standalone output needs static + public copied alongside server.js
cp -r public .next/standalone/public 2>/dev/null || true
cp -r .next/static .next/standalone/.next/static
EOSU
```

---

## 5. Install systemd units + start services

```bash
cp /opt/hireops/deploy/hireops-backend.service  /etc/systemd/system/
cp /opt/hireops/deploy/hireops-frontend.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now hireops-backend hireops-frontend

# Verify both are running and listening on loopback only
systemctl status hireops-backend  --no-pager
systemctl status hireops-frontend --no-pager
ss -tlnp | grep -E ':8017|:3017'
curl -fsS http://127.0.0.1:8017/health
```

Expected: backend returns `{"status":"ok",...}`, frontend logs show "Ready in Xs".

---

## 6. nginx vhost + TLS

```bash
cp /opt/hireops/deploy/nginx.hireops.symprio.com.conf /etc/nginx/sites-available/hireops.symprio.com
ln -sf /etc/nginx/sites-available/hireops.symprio.com /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Issue cert (DNS must already point to this VPS — see step 0)
certbot --nginx -d hireops.symprio.com --redirect --agree-tos -m dushy2009@gmail.com -n
```

certbot rewrites the vhost in place to wire up the cert. After it finishes:

```bash
systemctl reload nginx
curl -I https://hireops.symprio.com/health
```

Expect `200 OK`.

---

## 7. Smoke test

Open in a browser:

- `https://hireops.symprio.com` → marketing landing page renders
- `https://hireops.symprio.com/signup` → signup form works
- `https://hireops.symprio.com/api/v1/health` → `{"status":"ok",...}`

Then sign up with `dushy2009@gmail.com` (already in `SUPERADMIN_EMAILS`) — you should land on `/admin`.

---

## 8. Updating later

To deploy a new commit:

```bash
sudo -u hireops -H bash <<'EOSU'
cd /opt/hireops
git pull origin main

# Backend (only if requirements.txt changed, but cheap to always run)
cd backend && .venv/bin/pip install -r requirements.txt

# Frontend rebuild
cd ../frontend
npm ci
npm run build
cp -r public .next/standalone/public 2>/dev/null || true
cp -r .next/static .next/standalone/.next/static
EOSU

systemctl restart hireops-backend hireops-frontend
```

Wrap that in `/usr/local/bin/hireops-deploy.sh` once you've done it twice.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `502 Bad Gateway` | `systemctl status hireops-backend hireops-frontend`; check journal: `journalctl -u hireops-backend -n 50` |
| `ECONNREFUSED 127.0.0.1:5432` | Postgres not running: `systemctl start postgresql` |
| Frontend HTML loads but `/api/*` 404 | nginx vhost `location /api/` block missing or backend not listening on 8017 |
| `JWT_SECRET` warning at startup | The secret in `.env` is empty/default — generate with `openssl rand -hex 32` and restart |
| Email verification links don't arrive | Check postfix on host: `mailq`, `journalctl -u postfix`. Backend uses `SMTP_HOST=127.0.0.1:25` |
| Certbot fails | DNS hasn't propagated. `dig +short hireops.symprio.com` must return `45.127.7.249` |
| Logs filling disk | `journalctl --vacuum-time=14d` (systemd auto-rotates but you can force it) |

---

## What's NOT covered here

- **Backups.** `deploy/backup.sh` is for the docker setup. For native: `pg_dump hireops | gzip > /var/backups/hireops-$(date +%F).sql.gz` in a daily cron. Recommend setting up before going live.
- **Sentry.** Set `SENTRY_DSN` in `/opt/hireops/backend/.env` to enable. Optional but recommended.
- **Rate-limiting at nginx.** The slowapi middleware in the app handles login/signup rate limits in-memory. Fine for single-host. If you ever scale beyond one box, move to Redis-backed limiting.
