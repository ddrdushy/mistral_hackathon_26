# HireOps AI — Testing Quickstart

One-page TL;DR. **If you only have 30 minutes, read this.** Full details
live in [OPERATOR_SETUP_GUIDE.md](OPERATOR_SETUP_GUIDE.md) and
[TEST_PLAN.md](TEST_PLAN.md).

---

## 1. Minimum environment

The platform runs in **mock mode by default** — every AI agent has a deterministic
fallback so you can demo the full pipeline without paying for any third-party
service. The only thing you *must* set is a database URL (defaults to local SQLite).

For a real-mode demo you need at minimum:

```env
# backend/.env
MISTRAL_API_KEY=sk-...                  # Real AI scoring + classification
JWT_SECRET=<a long random string>       # Required — defaults to insecure dev key otherwise
INBOX_SECRET_KEY=<a long random string> # Fernet key for encrypted credentials
FRONTEND_URL=http://localhost:3000      # Used in interview/offer links
SUPERADMIN_EMAILS=you@example.com       # Auto-promoted on first signup
```

```env
# frontend/.env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Generate the two secrets:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"   # JWT_SECRET
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"  # INBOX_SECRET_KEY
```

---

## 2. Start the stack

```bash
docker compose up -d --build
docker compose ps              # all 4 services should be 'running'
curl http://localhost:8000/api/v1/health   # expect {"status":"ok"}
open http://localhost:3000
```

Seed demo data (optional but recommended for testers):

```bash
docker exec hireops-backend python seed/seed_db.py
```

---

## 3. First-boot checklist (operator, ~10 min)

1. Open http://localhost:3000 → sign up with the email you listed in
   `SUPERADMIN_EMAILS`. You're now a super-admin AND a tenant owner.
2. **Super-admin console**: visit `/admin` → confirm you can see Tenants, Plans,
   Stripe, Audit Log.
3. **Tenant settings**: `/settings` → confirm Plan = "Pro" (or whatever you set);
   the Pro plan unlocks every agent.
4. **(Optional) Twilio**: `/settings` → Integrations → Twilio → enter SID +
   token + phone. Needed only for voice call queue (Feature: phone screening).
5. **(Optional) SMTP**: env vars `SMTP_HOST/PORT/USER/PASS/FROM`. Needed for
   outbound rejection / interview-link emails.
6. **(Optional) Gmail OAuth**: `/settings` → Mail accounts → "Connect Gmail".
   Needed for the inbound mailbox listener.
7. **(Optional) ElevenLabs**: env vars `ELEVENLABS_API_KEY`,
   `ELEVENLABS_AGENT_ID`, `ELEVENLABS_WEBHOOK_SECRET`. Needed for the AI voice
   screening round.

If you skip 4–7, the relevant flows fall back to mock mode and still produce
sensible end-to-end data — just no real calls/emails/voice sent.

---

## 4. The 90-second smoke test

After the stack is up and you've signed up, run this to prove the core auto-
pipeline works end-to-end:

```bash
# 1. Confirm the backend sees your tenant
docker exec hireops-backend python -c "
from database import SessionLocal
from models import Tenant, User
db = SessionLocal()
print('tenants:', [(t.id, t.slug, t.plan) for t in db.query(Tenant).all()])
print('users:',   [(u.id, u.email, u.is_superadmin) for u in db.query(User).all()])
db.close()
"

# 2. Create a test job via the UI: /jobs → New Job → fill in title, skills,
#    save. (Or POST /api/v1/jobs — full API in OPERATOR_SETUP_GUIDE.md.)

# 3. Drop a test "email" into the inbox to trigger the auto-pipeline:
#    /inbox → "Upload .eml" (or use the test fixtures in /backend/seed/).

# 4. Watch the auto-pipeline fire:
docker logs -f hireops-backend | grep -E "classify|matched|score"
```

Expected outcome: within ~5–10s of the email landing you see in the logs:
*classified → matched → resume_scorer* and a new application appears in
`/candidates` with a score.

---

## 5. Where to go next

| You are… | Read this |
| --- | --- |
| Setting up the platform for the first time | [OPERATOR_SETUP_GUIDE.md](OPERATOR_SETUP_GUIDE.md) |
| About to test features as a QA / tester | [TEST_PLAN.md](TEST_PLAN.md) |
| Investigating a bug | [TEST_PLAN.md § "Diagnostics & verification"](TEST_PLAN.md#diagnostics--verification) |
| Configuring billing / plans | [OPERATOR_SETUP_GUIDE.md § Billing & plans](OPERATOR_SETUP_GUIDE.md#7-billing--plans-stripe) |

---

## 6. Mock vs real-mode cheat sheet

Every agent reads a `*_MOCK` env var. Default is **mock=True** (no real API
calls). Flip to **real** by either setting `MISTRAL_API_KEY` (real for every
agent at once) OR each specific `_MOCK=false` per agent:

| Variable | Default | What it controls |
| --- | --- | --- |
| `MISTRAL_API_KEY` | unset | If set, every Mistral agent uses real API unless explicitly mocked |
| `EMAIL_CLASSIFIER_MOCK` | true (unless key set) | Email category + confidence |
| `RESUME_SCORER_MOCK` | true | Resume score (0–100) + recommendation |
| `INTERVIEW_EVALUATOR_MOCK` | true | Interview transcript scoring |
| `INTERVIEW_QUESTION_GEN_MOCK` | true | AI-generated job-specific questions |
| `QA_INTERVIEW_MOCK` | true | LLM-driven Q&A interview round |
| `PROFILE_EXTRACTOR_MOCK` | true | Talent-bank profile from CV |
| `TALENT_SEARCH_MOCK` | true | Semantic candidate search |
| `HIRING_REPORT_MOCK` | true | Weekly report narrative |

A common testing flow: use **real Mistral** + **mock SMTP/Twilio/ElevenLabs**
so you exercise the AI without sending live email/SMS/calls.
