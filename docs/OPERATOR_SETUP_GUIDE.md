# HireOps AI — Operator Setup Guide

**Audience:** the person who configures the platform (you).
**Goal:** every UI feature works end-to-end and is testable.

This is the *complete* reference. For the 30-minute "just run it" path, see
[TESTING_QUICKSTART.md](TESTING_QUICKSTART.md).

---

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Environment variables](#2-environment-variables)
3. [First boot & super-admin promotion](#3-first-boot--super-admin-promotion)
4. [Per-tenant configuration](#4-per-tenant-configuration)
5. [Mistral agents](#5-mistral-agents)
6. [Email infrastructure (SMTP + Gmail OAuth)](#6-email-infrastructure-smtp--gmail-oauth)
7. [Billing & plans (Stripe)](#7-billing--plans-stripe)
8. [Voice screening (ElevenLabs)](#8-voice-screening-elevenlabs)
9. [Phone queue (Twilio)](#9-phone-queue-twilio)
10. [HRIS / ATS (Mock adapter only)](#10-hris--ats-mock-adapter-only)
11. [Plan gating & agent overrides](#11-plan-gating--agent-overrides)
12. [Audit log](#12-audit-log)
13. [Diagnostics / health checks](#13-diagnostics--health-checks)

---

## 1. Prerequisites

- **Docker Desktop 4.x+** (or `docker` + `docker compose` CLI)
- **8 GB RAM** free for the stack (Postgres + backend + frontend + backup)
- **Ports** 8000 (backend), 3000 (frontend), 5432 (Postgres) must be free
- **OS:** macOS or Linux (Windows works via WSL2)

Optional for production:
- A reverse proxy (nginx is in `/deploy/`)
- A real domain + TLS certificate

---

## 2. Environment variables

Set these in `backend/.env` (and reload with `docker compose restart backend`).
Anything *unset* falls back to a sensible mock or default.

### 2.1 Always required

| Variable | Example | Notes |
| --- | --- | --- |
| `JWT_SECRET` | `BNyD…48-chars…XY` | Session signing key. Use 48+ random chars. **Defaults to insecure dev key if unset** — change before production. |
| `INBOX_SECRET_KEY` | `<Fernet 32-byte base64>` | Encrypts tenant credentials (Twilio, mail, Stripe). Generate: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `FRONTEND_URL` | `http://localhost:3000` | Used when emailing interview/offer links. |
| `BACKEND_PUBLIC_URL` | `http://localhost:8000` | Used in OAuth redirects + ElevenLabs webhook URL. |
| `DATABASE_URL` | `postgresql://hireops:hireops@db:5432/hireops` | Docker-compose default. Switch to your own Postgres for prod. |

### 2.2 Super-admin promotion

| Variable | Example | Notes |
| --- | --- | --- |
| `SUPERADMIN_EMAILS` | `you@example.com,co@example.com` | Comma-separated. Auto-promotes matching users on every startup. |

### 2.3 Mistral (AI agents)

| Variable | Notes |
| --- | --- |
| `MISTRAL_API_KEY` | Your Mistral console key. If unset, every agent uses its deterministic mock. |
| `EMAIL_CLASSIFIER_AGENT_ID` | Mistral *agent* id for email classification. Default already wired in code (see `agents/email_classifier.py`). |
| `RESUME_SCORER_AGENT_ID` | Agent id for resume scoring. |
| `INTERVIEW_EVALUATOR_AGENT_ID` | Agent id for interview transcript scoring. |
| `TALENT_SEARCH_AGENT_ID` | Agent id for semantic candidate search. |
| `*_MOCK` | One per agent (e.g. `RESUME_SCORER_MOCK=false`). Per-agent override of mock fallback. |
| `INTERVIEW_QUESTION_GEN_MODEL` | Defaults to `mistral-large-latest`. |
| `PROFILE_EXTRACTOR_MODEL` | Defaults to `mistral-large-latest`. |
| `QA_INTERVIEW_MODEL` | Defaults to `mistral-large-latest`. |

### 2.4 ElevenLabs (voice round)

| Variable | Notes |
| --- | --- |
| `ELEVENLABS_API_KEY` | Account API key. |
| `ELEVENLABS_AGENT_ID` | The Round 1 ElevenLabs Conversational AI agent id. |
| `ELEVENLABS_ROUND2_AGENT_ID` | (Optional) Round 2 agent. Falls back to the round-1 agent if unset. |
| `ELEVENLABS_WEBHOOK_SECRET` | HMAC secret for webhook signature verification. |
| `ELEVENLABS_COST_PER_MIN` | USD per voice minute, used for usage tracking. Defaults to `0.04`. |

### 2.5 SMTP (outbound email)

| Variable | Example | Notes |
| --- | --- | --- |
| `SMTP_HOST` | `smtp.gmail.com` | Required to send email. |
| `SMTP_PORT` | `587` | |
| `SMTP_USER` | `noreply@yourdomain.com` | |
| `SMTP_PASS` | `app-password` | |
| `SMTP_FROM` | `HireOps AI <noreply@yourdomain.com>` | Display name + address. |
| `SMTP_USE_TLS` | `true` | STARTTLS. Set `false` for port 465 SSL. |
| `COMPANY_NAME` | `HireOps AI` | Branded in outbound email subjects/bodies. |

### 2.6 Gmail OAuth (inbound listener)

For tenants who want HireOps to pull candidate emails directly from their Gmail.
Set these once in env; per-tenant tokens are stored encrypted in
`mail_accounts`.

| Variable | Notes |
| --- | --- |
| `GMAIL_CLIENT_ID` | OAuth 2.0 client id from Google Cloud Console. |
| `GMAIL_CLIENT_SECRET` | OAuth secret. |
| `GMAIL_REFRESH_TOKEN` | (Optional) for headless setups; tenants normally do the OAuth dance. |

OAuth redirect URI to whitelist in Google Cloud Console:
`{BACKEND_PUBLIC_URL}/api/v1/inbox/oauth/google/callback`

### 2.7 Stripe (billing)

Two parallel credential sets — one for sandbox, one for prod — managed via the
super-admin console (`/admin/stripe`). The env vars below are *only* used as
fallback when nothing is in the DB.

| Variable | Notes |
| --- | --- |
| `STRIPE_STARTER_PRICE_ID` | `price_…` for the Starter monthly plan. |
| `STRIPE_PRO_PRICE_ID` | `price_…` for the Pro monthly plan. |

The actual secret/publishable/webhook keys live in DB (Stripe page). See
[§7 Billing & plans](#7-billing--plans-stripe).

### 2.8 Plan tuning

| Variable | Default | Notes |
| --- | --- | --- |
| `FREE_DAILY_LLM_BUDGET` | `1.0` (USD) | Daily Mistral spend cap for trial tenants. |
| `STARTER_DAILY_LLM_BUDGET` | `10.0` | Starter cap. |
| `PRO_DAILY_LLM_BUDGET` | `-1` | Unlimited. |
| `STARTER_PRICE_USD` | `49` | Display price on the billing page. |
| `PRO_PRICE_USD` | `199` | Display price. |

### 2.9 Frontend

```env
# frontend/.env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

---

## 3. First boot & super-admin promotion

```bash
cd /path/to/mistral hackathon
docker compose up -d --build
```

Wait ~20s, then:

```bash
curl http://localhost:8000/api/v1/health
# {"status":"ok","version":"1.0.0","service":"hireops-ai"}
```

**Sign up the first user** at http://localhost:3000/signup. The email must match
one of `SUPERADMIN_EMAILS` — otherwise you can promote later via the DB:

```bash
docker exec hireops-backend python -c "
from database import SessionLocal
from models import User
db = SessionLocal()
u = db.query(User).filter(User.email=='you@example.com').first()
u.is_superadmin = True; db.commit()
print('Promoted', u.email)
"
```

The super-admin console lives at http://localhost:3000/admin.

A `demo` tenant is auto-created on every boot via `_backfill_demo_tenant()` —
all legacy `tenant_id=NULL` rows get re-owned by it. You can ignore or rename it.

---

## 4. Per-tenant configuration

Every tenant has its own `/settings` area. As an operator you typically:

1. Create a tenant (super-admin: `/admin/tenants` → New).
2. Invite the tenant owner via email (`/admin/tenants/{id}` → "Invite owner").
3. The owner sets their plan, integrations, and team from the tenant `/settings`
   page after accepting the invite.

You (the super-admin) can impersonate / view-as any tenant via
`/admin/tenants/{id}` → "Open as tenant".

---

## 5. Mistral agents

Each agent is implemented in `backend/agents/<name>.py` with a real path and a
deterministic mock path.

| Agent | Used by | Mock env var |
| --- | --- | --- |
| Email classifier | Auto-pipeline (inbound mail → category) | `EMAIL_CLASSIFIER_MOCK` |
| Resume scorer | Match-to-job, manual rescore | `RESUME_SCORER_MOCK` |
| Interview question generator | "AI suggest" on job interview questions | `INTERVIEW_QUESTION_GEN_MOCK` |
| Profile extractor | Talent-bank profile from CV | `PROFILE_EXTRACTOR_MOCK` |
| Talent search | Semantic candidate search | `TALENT_SEARCH_MOCK` |
| Interview evaluator | Scoring voice transcripts | `INTERVIEW_EVALUATOR_MOCK` |
| Q&A interview | LLM-driven written interview round | `QA_INTERVIEW_MOCK` |
| Hiring report | Weekly report narrative | `HIRING_REPORT_MOCK` |

### How agents are billed

Every real call goes through `LLMCallTimer` → `record_llm_usage()`, which:

- Persists a row in `llm_usage` (tenant_id, user_id, cost_usd, tokens, latency).
- Daily total is enforced against `Plan.daily_llm_budget_usd` (cost_guard).
- Per-recruiter total surfaces on `/reports/recruiters` as `llm_cost_usd`.

To prove this works:

```bash
docker exec hireops-backend python -c "
from database import SessionLocal
from models import LlmUsage
db = SessionLocal()
for r in db.query(LlmUsage).order_by(LlmUsage.id.desc()).limit(5):
    print(r.created_at, r.agent_name, r.tenant_id, r.user_id, '$%.4f' % r.cost_usd)
db.close()
"
```

---

## 6. Email infrastructure (SMTP + Gmail OAuth)

### Outbound (SMTP)

- Set the `SMTP_*` env vars in §2.5.
- Verify with the backend `/api/v1/email/test-send` endpoint (super-admin only).
- All outbound mail (interview-link, rejection, offer-letter) routes through
  `services/smtp_service.py`.

### Inbound (Gmail OAuth, optional)

1. Google Cloud Console → APIs & Services → Credentials → "Create OAuth client
   ID" (Web application).
2. Authorised redirect URI: `{BACKEND_PUBLIC_URL}/api/v1/inbox/oauth/google/callback`
3. Add `GMAIL_CLIENT_ID` + `GMAIL_CLIENT_SECRET` to env.
4. Tenant owner: `/settings` → Mail accounts → "Connect Gmail" → consent screen.
5. The `mailbox_listener` background worker starts polling immediately (one
   loop per connected account).

To verify it's polling:

```bash
docker logs hireops-backend | grep mailbox_listener
# [mailbox_listener] Started loop for account 1
# [mailbox_listener] Started loop for account 2
```

---

## 7. Billing & plans (Stripe)

### One-time setup

1. **Super-admin console** → `/admin/stripe`.
2. Paste your **sandbox** secret/publishable/webhook keys + price ids → Save.
3. Toggle the **mode switch** to "sandbox".
4. Repeat with prod keys; flip the toggle when you want to go live.

Mode + credentials live in the `settings` table keyed `stripe.{mode}.{field}`,
so a redeploy doesn't lose them.

### Per-tenant plan changes

`/admin/tenants/{id}` → "Change plan" → Free / Starter / Pro / Trial. Triggers
re-sync of agent gates (`Plan.allowed_agents`) and daily LLM budget.

### Custom plan price / agent set

`/admin/plans` → edit a plan → set price and allowed agents. Overrides land in
`settings` table key `plan_override.{plan_name}` with a 30s cache.

### Per-tenant agent overrides

`/admin/tenants/{id}/agent-overrides` lets you unlock or lock individual agents
for one tenant without changing their plan — useful for one-off enterprise
deals.

---

## 8. Voice screening (ElevenLabs)

### 8.1 ElevenLabs console setup

1. Create a Conversational AI agent at
   https://elevenlabs.io/app/conversational-ai
2. Set the system prompt to reference dynamic variables — the platform
   passes the following on session start:
   - `{{candidate_name}}`
   - `{{job_title}}`
   - `{{custom_questions}}` (newline-joined, from Feature 4)
3. Copy the agent id → set `ELEVENLABS_AGENT_ID` in env.
4. Enable webhooks → URL: `{BACKEND_PUBLIC_URL}/api/v1/screening/webhook/elevenlabs`
5. Generate a webhook signing secret → set `ELEVENLABS_WEBHOOK_SECRET`.

### 8.2 Round 2 (optional)

If you have a separate prompt for the second round, create a second agent and
set `ELEVENLABS_ROUND2_AGENT_ID`. Otherwise round 2 reuses round 1.

### 8.3 Usage tracking

Every completed call writes to `voice_usage` (minutes × `ELEVENLABS_COST_PER_MIN`)
and shows up on `/reports/usage`.

---

## 9. Phone queue (Twilio)

1. Tenant `/settings` → Integrations → Twilio.
2. Paste **Account SID**, **Auth Token**, and a verified **outbound phone number**.
3. Inbound calls (Twiml URL): point your Twilio number's voice config at
   `{BACKEND_PUBLIC_URL}/api/v1/calls/twiml`.
4. The call-queue worker auto-starts at boot and processes queued candidates
   sequentially. Parallel dialling is currently OFF — change in
   `services/call_queue.py` if you need it.

Verify:

```bash
docker logs hireops-backend | grep -i twilio
docker exec hireops-backend python -c "
from database import SessionLocal
from models import TenantIntegration
db = SessionLocal()
for ti in db.query(TenantIntegration).filter(TenantIntegration.provider=='twilio'):
    print(ti.tenant_id, 'ok' if ti.encrypted_credentials else 'missing')
"
```

---

## 10. HRIS / ATS (Mock adapter only)

The full HRIS integration story (Merge.dev / Greenhouse / Lever / push hooks)
is **deferred — not on the current roadmap**. What ships today:

- `/settings/hris-integrations` UI is live.
- The **Mock provider** is fully working — pull cycle creates demo
  jobs / candidates / applications in your tenant. Use it for demos.
- `Merge` / `Greenhouse` / `Lever` cards show "Coming soon" and the connect
  button is disabled.

To enable the mock:

1. `/settings/hris-integrations` → "Mock provider" → Connect.
2. Enter any string as the "seed" (e.g. `demo`).
3. Hit "Sync now" — you should see 2 jobs + 2 candidates + 1 application
   imported into your tenant within ~1s.

---

## 11. Plan gating & agent overrides

Every plan has an `allowed_agents` set. Examples:

| Plan | Allowed agents |
| --- | --- |
| Trial / Free | `{email_classifier}` only |
| Starter | classifier + scorer + question_generator + 3 others |
| Pro | `{"*"}` (all agents) |

**Where this matters:** the auto-workflow gracefully creates an application
even when the scorer is locked — it stamps `recommendation="hold"` with an
"Upgrade your plan" CTA in `ai_next_action`. No 500s.

**Tenant-specific exceptions** can be set at `/admin/tenants/{id}/agent-overrides`:
unlock individual agents, or lock specific ones, without changing the plan
itself.

---

## 12. Audit log

Every privileged action writes a row to `audit_log`:

- Super-admin view: `/admin/audit-log`
- Tenant-owner view: `/settings` → Audit log

Action types covered (non-exhaustive):
- `tenant.suspend`, `tenant.delete`, `tenant.plan_change`
- `integration.twilio.create/update/delete`
- `integration.hris.connect/disconnect`
- `fraud.detected`, `fraud.blocked`, `fraud.override`
- `offer.send`, `offer.sign`, `offer.decline`
- `stripe.mode_switch`, `stripe.credentials_update`

Audit rows are append-only — no router writes UPDATE or DELETE. They survive
user deletion (actor_email is a snapshot).

---

## 13. Diagnostics / health checks

### Quick health

```bash
curl http://localhost:8000/api/v1/health
docker compose ps
docker logs hireops-backend --tail 50
```

### Per-feature sanity checks

```bash
# 1. Mistral key reachable
docker exec hireops-backend python -c "
import os
from mistralai import Mistral
key = os.getenv('MISTRAL_API_KEY','')
print('Mistral key set:' , bool(key))
if key:
    c = Mistral(api_key=key)
    print('Models reachable:', len(c.models.list().data))
"

# 2. SMTP reachable
docker exec hireops-backend python -c "
import smtplib, os
s = smtplib.SMTP(os.getenv('SMTP_HOST'), int(os.getenv('SMTP_PORT','587')))
s.starttls(); s.login(os.getenv('SMTP_USER'), os.getenv('SMTP_PASS'))
print('SMTP OK'); s.quit()
"

# 3. Background workers alive
docker logs hireops-backend 2>&1 | grep -iE "mailbox_listener|call queue|outreach worker|integrations sync worker"

# 4. Database migration state
docker exec hireops-backend python -c "
from sqlalchemy import inspect
from database import engine
insp = inspect(engine)
print('tables:', sorted(insp.get_table_names()))
"
```

### Reset to a clean demo state

```bash
docker compose down -v        # drops the Postgres volume
docker compose up -d --build  # starts fresh
docker exec hireops-backend python seed/seed_db.py   # reseed demo data
```

### Logs to monitor in production

| Source | What to watch |
| --- | --- |
| `hireops-backend` stdout | Workflow + worker errors, LLM call timing |
| `audit_log` table | Privileged actions, failed Stripe webhooks |
| `llm_usage` table | Daily spend per tenant (driven by cost guard) |
| `integration_sync_logs` table | Per-sync run history |
| `events` table | Per-application timeline |

---

## Appendix A — Service ports (Docker)

| Service | Container | Host port |
| --- | --- | --- |
| Backend (FastAPI) | `hireops-backend` | 8000 |
| Frontend (Next.js) | `hireops-frontend` | 3000 |
| Postgres | `hireops-db` | 5432 |
| Backup cron | `hireops-backup` | — |

## Appendix B — Background workers (auto-start at boot)

| Worker | What it does | Cadence |
| --- | --- | --- |
| `mailbox_listener` | Polls Gmail accounts for new mail, runs the auto-pipeline | per-account loop, ~30s |
| `call_queue` | Dials Twilio queued candidates | every 60s |
| `outreach_worker` | Sends due outreach sequence messages | every 60s |
| `hris_sync` | Pulls from connected HRIS providers | every 15 min |

Disable any worker by env var: `DISABLE_<WORKER_NAME>=true` (not implemented
yet — comment out the `start_worker()` call in `main.py` if needed).
