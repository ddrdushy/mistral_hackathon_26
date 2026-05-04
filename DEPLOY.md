# Deploy HireOps AI to your VPS (alongside symprio.com)

Step-by-step guide for putting HireOps AI live at **https://hireops.symprio.com**
on the same VPS that already runs **https://symprio.com**.

You run the commands. I prepared the configs. Paste output back to me at any
checkpoint marked **[CHECKPOINT]** and I'll review before you continue.

> **Goal**: zero impact on symprio.com. HireOps gets its own subdomain, its
> own ports (all on `127.0.0.1`), its own Postgres, its own backups.
> Your existing reverse proxy (Nginx/Caddy) gets one new server block.

---

## Phase 0 — Pre-flight (5 min)

### 0.1 DNS

In your DNS provider, add an A record:

```
hireops.symprio.com.   A   45.127.7.249
```

Wait for it to propagate (`dig +short hireops.symprio.com` should return your VPS IP).

### 0.2 SSH in, gather state

```bash
# From your laptop
ssh -p 8288 root@45.127.7.249

# What reverse proxy is running?
ss -tlnp | grep -E ':80|:443'

# What's already on Docker?
docker ps --format '{{.Names}}\t{{.Ports}}'
docker --version && docker compose version

# What ports are taken? (so we don't collide)
ss -tlnp 2>/dev/null | sort -u
```

**[CHECKPOINT 1]** — Paste the output. I'll confirm `127.0.0.1:8017 / 3017 / 5433`
are free and identify your reverse proxy. If anything conflicts, we adjust.

---

## Phase 1 — Get the code on the VPS (5 min)

```bash
# As root or your deploy user. Use a path under /opt or /srv conventionally.
mkdir -p /opt/hireops && cd /opt/hireops

git clone https://github.com/ddrdushy/mistral_hackathon_26.git .

# Pin to the latest released commit. (We'll add proper tags later.)
git log --oneline -1
```

---

## Phase 2 — Configure environment (10 min)

```bash
cd /opt/hireops
cp .env.production.example .env.production
chmod 600 .env.production

# Generate strong secrets
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
echo "JWT_SECRET=$(openssl rand -hex 32)"
```

Open `.env.production` and fill in:

| Required now | Source |
|---|---|
| `POSTGRES_PASSWORD` | from the openssl output above |
| `JWT_SECRET` | from the openssl output above |
| `MISTRAL_API_KEY` | https://console.mistral.ai/api-keys |
| `SUPERADMIN_EMAILS` | your email (gets `/admin` access on first signup) |
| `SMTP_HOST` | leave as `host.docker.internal` for VPS Postfix |
| `SMTP_FROM` | `noreply@hireops.symprio.com` |
| `COMPANY_NAME` | your brand label |

| Can defer (works without them, paid features dormant) |
|---|
| `STRIPE_SECRET_KEY`, `STRIPE_*_PRICE_ID` (paid plans show "Not configured") |
| `SENTRY_DSN` (no error tracking until set) |
| `ELEVENLABS_*` (voice interviews dormant; Q&A still works) |
| `GMAIL_*` (Gmail inbox sync dormant; manual candidate add still works) |

### 2.1 Postfix → container path

The backend container connects to your VPS Postfix via `host.docker.internal`.
On Linux you need to add this:

```bash
# Already in docker-compose.prod.yml? Verify:
grep -A2 "host.docker.internal" docker-compose.prod.yml || echo "missing — see below"
```

If missing, add this to each service in `docker-compose.prod.yml` that needs to send mail:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

(Backend already uses `SMTP_HOST=host.docker.internal` from env, so just make sure it can resolve.)

Also, Postfix needs to accept connections from Docker bridge:

```bash
# Add the docker bridge subnet to Postfix's mynetworks
postconf -e 'mynetworks = 127.0.0.0/8 [::ffff:127.0.0.0]/104 [::1]/128 172.16.0.0/12'
systemctl reload postfix
```

---

## Phase 3 — Build + start the stack (5 min)

```bash
cd /opt/hireops

# Build images (first time takes 3-5 min)
docker compose -f docker-compose.prod.yml --env-file .env.production build

# Start
docker compose -f docker-compose.prod.yml --env-file .env.production up -d

# Watch logs until backend prints "Application startup complete"
docker compose -f docker-compose.prod.yml logs -f backend
# Ctrl-C once you see it's healthy
```

**[CHECKPOINT 2]** — verify the stack is up:

```bash
# Should show 4 containers: hireops-prod-{db,backend,frontend,backup}
docker compose -f docker-compose.prod.yml ps

# Backend health (from VPS, before reverse proxy is wired)
curl -fsS http://127.0.0.1:8017/api/v1/health
curl -fsS http://127.0.0.1:8017/api/v1/health/db
curl -fsS http://127.0.0.1:8017/api/v1/health/llm

# Frontend health
curl -fsS http://127.0.0.1:3017/ | head -c 200
```

All four should respond. If any fail, paste the error and the relevant container's logs.

---

## Phase 4 — Reverse proxy (10 min)

### Option A: Nginx (most common on Ubuntu/Debian VPS)

```bash
# Drop the server block in
cp /opt/hireops/deploy/nginx.hireops.symprio.com.conf /etc/nginx/sites-available/hireops.symprio.com
ln -s /etc/nginx/sites-available/hireops.symprio.com /etc/nginx/sites-enabled/

# Validate before reload
nginx -t

# Reload
systemctl reload nginx

# Get a Let's Encrypt cert (uses your existing certbot install)
certbot --nginx -d hireops.symprio.com --redirect --agree-tos -m you@symprio.com
```

certbot will edit the file in place to add the SSL block. Verify:

```bash
curl -fsS https://hireops.symprio.com/api/v1/health
```

### Option B: Caddy

```bash
# Append the fragment to your Caddyfile
cat /opt/hireops/deploy/Caddyfile.hireops >> /etc/caddy/Caddyfile

caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy

# Caddy auto-issues the cert on first request
curl -fsS https://hireops.symprio.com/api/v1/health
```

**[CHECKPOINT 3]** — `https://hireops.symprio.com/api/v1/health` returns
`{"status":"ok",...}` and `https://hireops.symprio.com/` shows the landing page.

---

## Phase 5 — Smoke test (5 min)

In your browser:

1. **https://hireops.symprio.com/** — landing page renders
2. **https://hireops.symprio.com/signup** — create a test account using your superadmin email
3. **Verify email arrives** at the address you signed up with (Postfix delivers it)
4. Click verify link → land on `/dashboard`
5. **https://hireops.symprio.com/admin** — superadmin panel shows tenants
6. **https://hireops.symprio.com/settings/billing** — usage bars + plans visible
7. Open user menu → click "Sign out" → log back in

## Phase 6 — Stripe webhook + monitoring (10 min, optional)

### Stripe webhook

In Stripe dashboard → Developers → Webhooks → **Add endpoint**:

- URL: `https://hireops.symprio.com/api/v1/billing/webhook`
- Events: `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.payment_failed`

Copy the signing secret (`whsec_...`) into `.env.production` as `STRIPE_WEBHOOK_SECRET`,
then:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --force-recreate backend
```

### Sentry (optional but recommended)

Create a free project at https://sentry.io. Copy the DSN into
`.env.production` as `SENTRY_DSN=https://...`, then recreate the backend (same
command as above).

---

## Phase 7 — Operational hygiene

### Log location

```bash
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f frontend
tail -f /var/log/nginx/hireops.access.log
```

### Backups

The `backup` service auto-runs `pg_dump` every 24h. Backups land in
`/var/backups/hireops/{daily,weekly,monthly}/` on the host. To restore:

```bash
# List available dumps
ls -lh /var/backups/hireops/daily/

# Restore a specific dump (DESTRUCTIVE — wipes current DB)
gunzip -c /var/backups/hireops/daily/2026-05-05_04-00-00.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T db psql -U hireops -d hireops
```

### Off-host backup copies (recommended)

Add to root's crontab:

```cron
30 4 * * * rsync -a /var/backups/hireops/ user@offsite-host:/backups/hireops/
```

### Update flow

```bash
cd /opt/hireops
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

### Rollback flow

```bash
cd /opt/hireops
git log --oneline -10
git checkout <previous-commit-sha>
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `502 Bad Gateway` | Container down | `docker compose -f docker-compose.prod.yml ps` then `logs <service>` |
| Cookie not setting after login | `COOKIE_SECURE=true` but visiting via HTTP | Always use HTTPS in production |
| Verification email not arriving | Postfix not reachable from container | Check `host.docker.internal` resolves; check `mynetworks` includes Docker bridge |
| Stripe checkout 503 | `STRIPE_*` env vars not set | Fill in `.env.production` and recreate backend |
| `/health/llm` returns 503 | `MISTRAL_API_KEY` missing | Add to `.env.production` and recreate backend |
| Build fails: `npm ci` peer-dep | (Already handled) | Dockerfile uses `npm ci --legacy-peer-deps` |

---

## Final reminder

Once everything's live:

1. **Rotate the SSH password** that was shared in chat:
   ```bash
   passwd
   ```
2. (Recommended) Add an SSH key + disable password auth:
   ```bash
   # On your laptop:
   ssh-copy-id -p 8288 root@45.127.7.249
   # Then on the VPS, edit /etc/ssh/sshd_config:
   #   PasswordAuthentication no
   systemctl reload sshd
   ```
3. Take a backup-restore drill:
   ```bash
   ls /var/backups/hireops/daily/   # confirm dumps are landing
   ```
