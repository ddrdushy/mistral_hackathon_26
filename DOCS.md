# HireOps AI — Project Documentation

This doc is the canonical reference for the HireOps AI codebase. Read top-to-bottom to onboard, or jump to a section.

> Quick links: [README](README.md) · [DEPLOY (Docker)](DEPLOY.md) · [NATIVE_DEPLOY](deploy/NATIVE_DEPLOY.md) · [ROADMAP](ROADMAP.md) · [SUPERADMIN_ROADMAP](SUPERADMIN_ROADMAP.md)

---

## Table of contents

1. [Overview](#overview)
2. [Tech stack](#tech-stack)
3. [Architecture](#architecture)
4. [Project structure](#project-structure)
5. [Multi-tenancy model](#multi-tenancy-model)
6. [Pipeline & workflow](#pipeline--workflow)
7. [Features](#features)
8. [Database schema](#database-schema)
9. [Background workers](#background-workers)
10. [Integrations](#integrations)
11. [API reference](#api-reference)
12. [Configuration (env vars)](#configuration-env-vars)
13. [Local development](#local-development)
14. [Docker (dev)](#docker-dev)
15. [Deployment](#deployment)
16. [Operations & troubleshooting](#operations--troubleshooting)
17. [File-by-file map](#file-by-file-map)

---

## Overview

HireOps AI is a multi-tenant, agentic recruiting platform. It automates the full hiring pipeline from inbound emails to final hiring decisions, with humans-in-the-loop only where it matters.

**Core flow:**

```
inbox → classify → parse resume → match to job → score → screen → interview → decide
```

Every stage is automated by default but configurable per-tenant: resume score thresholds, interview thresholds, voice vs Q&A interview mode, auto-advance vs hold-for-HR, etc. Tenants can also bring their own integrations (mailbox, Twilio, job boards) so HireOps fits their existing stack.

The project also contains a separate super-admin shell (`/admin/*`) for platform owners to manage tenants, users, billing, audit logs, and platform-wide settings.

---

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Backend | FastAPI 0.115 + SQLAlchemy 2.0 | Async-first, fast, strong typing |
| ORM target | SQLite (dev) / Postgres 16 (prod) | Single-binary dev; serious prod |
| Migrations | Idempotent on-startup ALTER TABLE | No Alembic complexity for a fast-moving hackathon project |
| Frontend | Next.js 15 (App Router) + TypeScript + Tailwind CSS | SSR-capable, modern, great DX |
| Auth | argon2 password hashing + JWT cookie | Stateless, HttpOnly, SameSite=Lax |
| Rate limiting | slowapi (in-memory) | Adequate for single-host; trade for Redis when scaling |
| Background work | asyncio tasks in main process | Mailbox listener, call queue worker, profile extractor |
| LLM | Mistral (`mistral-small-latest`, custom Mistral Agents) | Recruitment-tuned agents + chat fallback |
| Voice | ElevenLabs (TTS + Conversational AI) | High-quality, low-latency |
| Telephony | Twilio (per-tenant) | Outbound voice + WhatsApp |
| Payments | Stripe (Checkout + Customer Portal + webhooks) | Industry standard |
| Email | Postfix (SMTP, on the VPS) | Existing infra at the deployment site |
| Encryption | Fernet (cryptography lib) for tenant secrets | Symmetric, simple, rotatable |
| Reverse proxy (prod) | Nginx | Existing host setup |
| Container | Docker Compose (dev + prod profiles) | Reproducible, env-isolated |

---

## Architecture

```
                ┌──────────────────┐         ┌────────────────────┐
                │  Next.js (3000)  │ ───────▶│  FastAPI (8000)    │
                │  App Router      │  REST   │  /api/v1/*         │
                │  Tailwind CSS    │ ◀───────│                    │
                └──────────────────┘         └─────────┬──────────┘
                                                       │
              ┌────────────────────────────────────────┼─────────────────────────────┐
              │                                        │                             │
              ▼                                        ▼                             ▼
   ┌────────────────────┐                ┌────────────────────┐         ┌────────────────────┐
   │ Postgres / SQLite  │                │ Background workers │         │ External services  │
   │  - tenant data     │                │  - mailbox_listener│         │  - Mistral API     │
   │  - applications    │                │  - call_queue_     │         │  - ElevenLabs API  │
   │  - audit log       │                │    worker          │         │  - Twilio REST     │
   │  - communications  │                │  - profile_extract │         │  - Stripe API      │
   └────────────────────┘                └────────────────────┘         └────────────────────┘
                                                  │                              ▲
                                                  └──────────────────────────────┘
                                                            via tenant creds
```

**Two frontend shells:**

- `(dashboard)` — regular HR users. Sidebar nav: Dashboard, Inbox, Jobs, Candidates, Talent Bank, Call Queue, Reports, Settings.
- `(admin)` — super-admin only. Tenants, Users, Analytics, Audit log, Platform settings.

Both are guarded by separate auth components (`AuthGate` / `AdminGate`) that read `/api/v1/auth/me`.

**Public routes** (no auth):
- `/landing/*` — marketing site
- `/login`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password`
- `/interview/[token]` — candidate-facing voice/Q&A interview room
- `/api/v1/calls/twiml/*`, `/api/v1/calls/twilio/status`, `/api/v1/billing/webhook` — webhook endpoints (signature verified where applicable)

---

## Project structure

```
mistral hackathon/
├── backend/                           # FastAPI app
│   ├── main.py                        # App entry — routes, startup hooks, CORS
│   ├── database.py                    # SQLAlchemy engine + idempotent migrations
│   ├── models.py                      # All ORM models in one file
│   ├── schemas.py                     # Pydantic request/response schemas
│   ├── auth/                          # JWT, dependencies, rate-limit helpers
│   ├── billing/                       # Stripe, plans, cost guard
│   ├── agents/                        # LLM agent wrappers (Mistral)
│   │   ├── email_classifier.py
│   │   ├── resume_scorer.py
│   │   ├── job_generator.py
│   │   ├── profile_extractor.py       # talent-bank tagger
│   │   ├── qa_interview.py
│   │   ├── voice_screener.py
│   │   ├── interview_evaluator.py
│   │   ├── hiring_report.py
│   │   └── talent_search.py
│   ├── services/                      # Business logic, integrations, workers
│   │   ├── workflow_service.py        # The auto-pipeline
│   │   ├── mailbox_listener.py        # Per-tenant IMAP poller
│   │   ├── call_queue.py              # Phone queue worker + Twilio dispatch
│   │   ├── twilio_service.py          # Twilio REST adapter
│   │   ├── email_service.py           # IMAP fetch + parse
│   │   ├── smtp_service.py            # Outbound email (Gmail API + Postfix)
│   │   ├── gmail_service.py           # Legacy single-tenant Gmail OAuth
│   │   ├── mail_account_service.py    # Per-tenant MailAccount CRUD
│   │   ├── job_board_service.py       # Apollo / talent-source adapters
│   │   ├── resume_service.py          # PDF/DOCX text extraction
│   │   ├── secrets_crypto.py          # Fernet for tenant secrets
│   │   ├── secrets.py                 # DB-stored global secrets → env
│   │   ├── llm_tracker.py             # Per-call usage logger
│   │   ├── csv_service.py             # CSV exports
│   │   └── demo_seed.py               # Sample data + clear_demo
│   └── routers/                       # FastAPI routers (one per resource)
│       ├── auth.py, admin.py, team.py, billing.py
│       ├── inbox.py, jobs.py, candidates.py, applications.py
│       ├── screening.py, reports.py, settings.py, metrics.py
│       ├── talent.py, testimonials.py
│       ├── integrations.py            # tenant Twilio config
│       ├── communications.py          # WhatsApp send + log
│       └── calls.py                   # phone queue endpoints + Twilio webhooks
├── frontend/                          # Next.js 15 app
│   └── src/
│       ├── app/
│       │   ├── (dashboard)/           # HR shell
│       │   │   ├── dashboard/page.tsx
│       │   │   ├── inbox/page.tsx
│       │   │   ├── jobs/...
│       │   │   ├── candidates/...
│       │   │   ├── talent-bank/page.tsx
│       │   │   ├── calls/page.tsx
│       │   │   ├── reports/page.tsx
│       │   │   └── settings/...
│       │   ├── (admin)/admin/...      # super-admin shell
│       │   ├── (public)/              # landing, interview rooms
│       │   └── (auth)/                # login / signup / etc.
│       ├── components/
│       │   ├── auth/                  # AuthGate, AdminGate, banners
│       │   ├── layout/                # Sidebar, Topbar, DashboardShell
│       │   ├── admin/                 # AdminShell, AdminSidebar
│       │   ├── inbox/                 # EmailIntegrations
│       │   ├── talent/                # TalentSearchPanel, JobBoardIntegrations
│       │   ├── tour/                  # Onboarding tour
│       │   └── ui/                    # Card, Button, EmptyState, etc.
│       ├── hooks/                     # useFaceTracking, etc.
│       ├── lib/                       # api.ts, constants.ts
│       └── types/                     # shared TS types
├── deploy/                            # systemd units, nginx vhost, backup script
├── docker-compose.yml                 # dev stack (db + backend + frontend + backup)
├── docker-compose.prod.yml            # prod overrides (127.0.0.1 binds)
├── docker-compose.override.yml        # dev-only auto-reload
├── DEPLOY.md                          # Docker deploy guide
├── ROADMAP.md / SUPERADMIN_ROADMAP.md # planning notes
└── DOCS.md                            # this file
```

---

## Multi-tenancy model

Every tenant-scoped table has a `tenant_id` foreign key to `tenants(id)`. Defensive scoping is the rule:

- Every read filters on `Application.tenant_id == session.tenant.id`
- Every write sets `tenant_id` from the authenticated session
- The auth dependency `current_session` resolves JWT → tenant + user, sets `cost_guard.set_active_tenant()` so background LLM calls inherit the right tenant for billing

**Tenant lifecycle:**

| State | `tenants.deleted_at` | Behaviour |
| --- | --- | --- |
| Active | NULL | Normal usage |
| Soft-deleted | timestamp | Logins blocked. 30-day grace before super-admin can hard-delete |
| Hard-deleted | (row removed) | All data cascade-removed via super-admin endpoint |

Per-user disable lives in `users.disabled_at`. A disabled user can't log in but the tenant stays alive (other users in the org keep working).

**Demo seed:** every newly-signed-up tenant gets a few sample jobs and candidates so the dashboard isn't empty. Marked with `[DEMO]` in `Job.description` and `source_email_id IS NULL` on candidates so they're easy to clear via Settings → Demo data → Clear demo data.

---

## Pipeline & workflow

The auto-pipeline lives in `services/workflow_service.run_email_workflow(email_id, db)`. It's invoked by:

- The mailbox listener after pulling new IMAP messages (auto)
- `POST /api/v1/inbox/run-workflow` (manual button on Inbox page)
- `POST /api/v1/applications/{id}/rescore` (manual re-score on candidate detail)

**Stages stored on `Application.stage`:**

```
new → classified → matched → screening_scheduled → screened → shortlisted | rejected
```

**End-to-end happy path:**

1. **Classify** (`agents/email_classifier`) — Mistral agent decides if the email is a `candidate_application` or `general`. If general, the email is processed and we stop.
2. **Create candidate** (`_create_candidate_from_email`) — extract resume text from attachment + email body, parse contact info, create `Candidate` row tagged with the email's tenant.
3. **Profile extract** (`agents/profile_extractor`) — fire-and-forget Mistral call that produces structured tags (skills, role, seniority, years, summary, key_points). Cached forever on the candidate row so future job matches don't re-LLM.
4. **Match to job** — pick best-matching open job for this tenant (title similarity + resume_text overlap). Falls back to the first open job. Skips if no open jobs (candidate still lives in the talent bank).
5. **Score** (`agents/resume_scorer`) — Mistral agent returns score 0–100 + evidence + gaps + risks + recommendation (`advance` / `hold` / `reject`) + screening_questions + per-card snippets.
6. **Decide** based on tenant thresholds (`Job.resume_threshold_min`, `Job.interview_threshold_min`, `Job.final_threshold_reject`):
   - `recommendation=advance` → auto-generate interview link, auto-email it
   - `recommendation=hold` → stays at `matched`, surfaces in dashboard's "Needs action"
   - `recommendation=reject` → stays at `matched` with `recommendation=reject` for HR review
7. **Interview** — candidate clicks link, joins voice or Q&A room (`Job.interview_mode`):
   - **Voice**: ElevenLabs Conversational AI agent runs the conversation, transcribes, evaluates
   - **Q&A**: hybrid MCQ + free-form, multi-round (apt → reasoning → technical from CV)
   - Anti-fraud: real-time face tracking via webcam (attention %, off-screen events), behavioural signals (typing patterns, paste detection)
8. **Evaluate** (`agents/interview_evaluator`) — Mistral agent scores communication / technical / cultural fit, computes `final_score`, writes `final_summary`.
9. **Final decision** — auto-shortlist if `final_score >= interview_threshold_min`, auto-reject if `final_score < final_threshold_reject`, otherwise `hold` for HR.

Every state transition writes an `events` row, which feeds the activity timeline on the candidate detail page.

---

## Features

### Inbox & email automation

- **Per-tenant mailboxes**: Gmail (IMAP + app password), Outlook/Exchange, Yahoo, iCloud, AOL, generic IMAP, POP3. Credentials encrypted at rest.
- **Auto-pickup listener** spawns one asyncio task per `MailAccount`, polls every ~20s, classifies new emails, runs the workflow.
- **Pause toggle** per mailbox (cost control without disconnecting).
- **Manual sync** button still works for on-demand fetch.
- **Legacy Gmail OAuth** path retained for the original single-tenant deploy (`gmail_service.py`).

### Jobs

- **AI-generated JDs**: type a title, Mistral fills in skills, responsibilities, qualifications, description.
- **CRUD** with race-safe `JOB-YYYY-NNN` ID allocation (table-wide unique, retried on `IntegrityError`).
- **Per-job thresholds**: resume_threshold_min, interview_threshold_min, final_threshold_reject.
- **Interview mode**: `voice` (ElevenLabs agent) or `qa` (hybrid MCQ).
- **Cascade delete**: removing a job clears its applications, interview links, Q&A sessions, events.

### Candidates & applications

- **Candidate detail page** consolidates everything for one application:
  - Header: name, email, phone, score gauges, recommendation
  - Resume Score card with Re-score button
  - Interview Score + AI insights
  - Send WhatsApp card (Phase 2)
  - Phone Queue card (Phase 3a)
  - **CV History** card (v1, v2, v3 ... with View modal for archived versions)
  - **Activity Timeline** card (chronological merge of every event)
- **CV versioning**: re-uploading a CV by email match bumps `cv_version`, archives the previous CV in `candidate_cv_versions` (filename + full text + timestamp), forces profile re-extraction so tags follow latest.
- **Manual CV upload** with multi-file support: drag in 1–25 PDFs/DOCXs at once, auto-parsed for contact info, profiled by LLM, results shown inline in the modal.
- **Re-score** button re-extracts text from email attachment + body and re-runs the scorer.

### Talent Bank (`/talent-bank`)

- Card grid of every candidate with their AI profile (role, seniority, years, summary, key-point bullets, skill tags).
- Status badge: "N applications" (in pipeline) vs "Talent bank" (passive pool).
- "Unassigned only" toggle filters to candidates without applications.
- Upload CV (single or bulk) is the primary action.
- **Suggestions per job**: `GET /api/v1/jobs/{id}/suggested-candidates` ranks the talent bank against a job by skill-tag overlap + role/seniority bonus. Zero LLM calls per match — uses cached profiles. Lazy-fills profiles for legacy candidates (capped 8 per request to stay within budget).

### Call Queue (`/calls`)

- **Schema**: `call_queue(scheduled_for, status, purpose, to_phone, twilio_call_sid, transcript, outcome, rescheduled_to_id, retry_count)`
- **Worker**: single asyncio task spawned at app boot, polls every 30s for `pending AND scheduled_for <= now()`. Bounded to 3 concurrent calls per tenant.
- **Dispatch**: POST to Twilio's `Accounts/{sid}/Calls.json` with `Url` (TwiML callback) + `StatusCallback`. Logs a parallel `Communication` row so the candidate timeline shows the attempt.
- **TwiML endpoint**: `/api/v1/calls/twiml/{call_id}` returns per-purpose `<Say>` greeting (screening / reschedule / reminder / availability_check / custom). Phase 3b will swap in `<Connect><Stream>` to ElevenLabs Conversational AI.
- **Status webhook**: `/api/v1/calls/twilio/status` reconciles Twilio statuses (initiated/ringing/answered/completed/failed/no-answer/busy) onto our queue states.
- **Reschedule chain**: original row marked `rescheduled`, new pending row enqueued at the new time, linked via `rescheduled_to_id`.
- **Retries**: exponential backoff (60s → 30 min cap), MAX_RETRY=2, surfaces as `failed` after that.
- **UI**: top-level page with status counters, status tabs (All / Active / Completed / Failed / Cancelled), per-row click for detail modal (transcript, outcome details, reschedule form). Auto-refreshes every 15s while any call is active.

### Communications log

- **Channel-agnostic** `communications(channel, direction, status, to_address, body, error, metadata, sent_by_user_id, sent_at, delivered_at)`.
- Email, WhatsApp, voice all live in the same audit table — single source of truth for the candidate timeline.
- **Manual WhatsApp send** from the candidate detail page (uses tenant Twilio config).
- **Auto WhatsApp on stage transitions** (Phase 3b — not yet shipped).

### Tenant integrations

- **Twilio per-tenant** (`/settings` → Twilio card): account SID, auth token (encrypted), WhatsApp from-number, optional SMS from-number, enabled toggle, last error, send-test button.
- **Mailbox per-tenant** (`/inbox` → Email Integrations): Gmail/Outlook/Yahoo/iCloud/Exchange/AOL/IMAP/POP3 with provider presets.
- **Job boards per-tenant** (`/settings` → Job Board Integrations): platform-default Apollo + tenant overrides.
- **ElevenLabs** is platform-managed (single env var `ELEVENLABS_API_KEY`). Voice usage is metered against the platform's account.
- **Mistral** is platform-managed. Per-tenant LLM budget enforced by `billing.cost_guard` (daily cap from plan tier).

### Anti-fraud (interview rooms)

- **Face tracking** via MediaPipe Tasks Vision, logs face_present%, off-screen events, multi-face frames.
- **Behavioural signals**: paste detection, abnormal typing speed, focus loss events.
- Composite **fraud_risk_score** stored per Q&A session, surfaces on candidate detail.

### Scheduling

- **Slot booking**: candidate proposes a slot during interview, HR confirms via candidate detail's "Book Interview Slot" card.
- **ICS calendar invite** auto-generated and sent via SMTP.
- **Reschedule** path planned for Phase 3b (transcript-driven via voice agent).

### Billing & quotas (`billing/`)

- **Stripe Customer + Checkout + Customer Portal** flow.
- **Webhooks**: signature-verified, no nginx-level filtering, body never modified.
- **Per-tenant LLM cost guard** (`cost_guard.py`): contextvar-based, every Mistral / ElevenLabs call goes through `LLMCallTimer` which writes to `llm_usage` and pre-flight checks the daily cap (`Plan.daily_llm_budget_usd`).
- **Quotas** (`plans.py`): jobs, candidates, applications per tier (Free / Starter / Pro), enforced at create-time via `check_quota`.
- **Usage meter** card on Inbox page shows tenant's daily/monthly classifier spend.

### Super-admin (`/admin`)

- Separate route group, separate `AdminGate`, separate sidebar.
- **Tenants**: list, detail, edit, suspend, restore (within 30-day window), hard-delete, export full tenant data as a single JSON.
- **Users**: cross-tenant search, detail, password reset, mark verified, disable, grant/revoke superadmin.
- **Analytics**: cross-tenant signup, application volume, LLM spend.
- **Audit log**: every privileged super-admin action recorded with `action_type`, `target_tenant_id`, `payload`.
- **Platform settings**: stub at `/admin/settings` linking to env-var driven config.
- **Promotion at signup**: `SUPERADMIN_EMAILS` env var auto-promotes users on signup or boot. New superadmins are routed to `/admin` not `/dashboard`.

---

## Database schema

Tables grouped by area. All have `created_at` / `updated_at` unless noted.

**Auth & multi-tenancy:**
- `tenants(slug, name, plan, stripe_customer_id, deleted_at)` — soft-delete via `deleted_at`
- `users(email, password_hash, tenant_id, role, is_superadmin, email_verified_at, disabled_at)`
- `email_verifications(token, user_id, expires_at, used_at)`
- `password_resets(token, user_id, expires_at, used_at)`
- `tenant_invites(email, role, token, expires_at, accepted_at)`
- `audit_log(actor_user_id, action_type, target_tenant_id, payload)`

**Pipeline data (all tenant-scoped):**
- `jobs(job_id, title, department, location, seniority, skills, responsibilities, qualifications, description, status, interview_mode, resume_threshold_min, interview_threshold_min, final_threshold_reject)`
- `emails(message_id, from_address, from_name, subject, body_full, attachments, classified_as, confidence, classification, processed)`
- `candidates(name, email, phone, resume_text, resume_filename, cv_version, source_email_id, notes, profile_skills, profile_role, profile_seniority, profile_years_experience, profile_summary, profile_key_points, profile_extracted_at)`
- `candidate_cv_versions(candidate_id, version_number, filename, resume_text, source, uploaded_by_user_id, uploaded_at)`
- `applications(candidate_id, job_id, stage, resume_score, resume_score_json, interview_score, recommendation, ai_next_action, ai_snippets, scheduled_interview_at, scheduled_interview_slot, email_draft_sent, final_score, final_summary, screening_status, interview_link_status)`
- `events(app_id, event_type, payload)` — every state transition
- `interview_links(token, app_id, status, expires_at, opened_at, interview_started_at, interview_completed_at, round, scheduled_at, face_tracking_json)`
- `qa_sessions(app_id, transcript_json, mcq_answers_json, evaluation_json, signals_json, fraud_risk_score, completed_at)`
- `settings(tenant_id, key, value)` — generic kv

**Integrations & comms:**
- `mail_accounts(provider, auth_method, email_address, imap_*, secret_encrypted, status, listener_enabled, last_error, last_sync_at)`
- `job_board_accounts(provider, secret_encrypted, ...)`
- `tenant_integrations(provider, config_json, secret_encrypted, enabled, last_error, last_used_at)` — currently used for Twilio
- `communications(candidate_id, app_id, channel, direction, status, to_address, from_address, subject, body, metadata_json, error, sent_by_user_id, sent_at, delivered_at)`
- `call_queue(candidate_id, app_id, purpose, status, scheduled_for, to_phone, twilio_call_sid, elevenlabs_conversation_id, script_prompt, transcript, outcome, outcome_details_json, rescheduled_to_id, retry_count, last_error, attempted_at, completed_at)`

**Other:**
- `llm_usage(tenant_id, agent_name, mode, input_tokens, output_tokens, latency_ms, status, metadata)`
- `testimonials(quote, author_name, author_role, avatar_url, display_order, is_active)` — landing page

**Migrations** are ALTER TABLE ADD COLUMN statements in `database._run_migrations()`. Idempotent. Runs on every boot.

---

## Background workers

All in-process asyncio tasks spawned during FastAPI startup (`main.on_startup`). One worker per backend process — uvicorn must run with `--workers 1`.

| Worker | File | Trigger | Cadence |
| --- | --- | --- | --- |
| Mailbox listener | `services/mailbox_listener.py` | App boot | Per `MailAccount`, every 20s |
| Mailbox backfill | (same) | App boot, one-shot | Once, classifies up to 200 unprocessed emails |
| Call queue | `services/call_queue.py` | App boot | Every 30s, dispatches due rows |
| Async profile extract | `services/workflow_service._async_apply_profile` | Per new candidate | On-demand fire-and-forget |

**Why single-worker:** the listeners use module-level state and asyncio task registries. Multiple uvicorn workers would each spawn their own listener and race on the IMAP inbox or the call queue. To scale beyond one box, factor the workers out into a separate process (e.g. `arq`, `celery`, or a custom asyncio service) and elect one leader via the DB.

Both `mailbox_listener._poll_loop` and `call_queue._worker_loop` wrap every iteration in try/except so a transient DB hiccup never silently kills the task.

---

## Integrations

### Mistral (LLM)

- One platform key (`MISTRAL_API_KEY`).
- Three Mistral Agents in production (IDs in env or hardcoded fallback):
  - Email Classifier (`ag_019ca2d9a7a0773cb0104da31ed35b09`)
  - Resume Scorer (`ag_019ca3046554772bbbdf4d2b75bdd657`)
  - Interview Evaluator (TBD)
- Profile Extractor uses chat API directly (not an agent) — no need to provision a separate agent for a short JSON-only prompt.
- Per-tenant cost guard: every call goes through `LLMCallTimer` which writes a `llm_usage` row tagged with the active tenant.

### ElevenLabs (voice)

- Platform-managed (one `ELEVENLABS_API_KEY`).
- Used for:
  - Voice screening: web-room WebSocket conversation
  - TwiML phone calls (Phase 3b will plug ElevenLabs Conversational AI into the `/calls/twiml/{id}` response)

### Twilio (per-tenant)

- Configured via `/settings` → Twilio card.
- Uses Twilio REST API directly via httpx (no SDK dep).
- WhatsApp send + outbound voice call.
- Auth token encrypted at rest.

### Stripe

- Platform-level (one secret + one webhook secret).
- Customers created lazily on first plan upgrade.
- Customer Portal for self-serve plan/payment management.
- Webhooks signature-verified, mapped to plan changes / dunning / cancellation.

### Postfix (SMTP — VPS)

- Postfix runs on the host (existing infra).
- Backend uses `SMTP_HOST=127.0.0.1:25` from inside Docker (`host.docker.internal:25` on macOS dev) for transactional emails (verification, password reset, invites).
- Outbound interview emails currently go via Gmail API (legacy, single-tenant). Phase 3b will route them through tenant Twilio for WhatsApp delivery.

---

## API reference

All endpoints live under `/api/v1`. Auth via JWT cookie; `current_session` resolves tenant + user.

### Auth & team

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/auth/signup` | rate-limit | Create tenant + user, send verification email |
| POST | `/auth/login` | rate-limit | Issue JWT cookie |
| POST | `/auth/logout` | session | Clear cookie |
| GET | `/auth/me` | session | Current user + tenant |
| POST | `/auth/verify-email` | public, signed | Mark email verified |
| POST | `/auth/forgot-password` / `/reset-password` | public, signed | Reset flow |
| POST | `/team/invite` / `/team/accept-invite` | owner / signed | Invite teammates |
| POST | `/team/clear-demo` | owner | Wipe seeded demo data |

### Inbox & jobs & candidates & applications

| Method | Path | Description |
| --- | --- | --- |
| GET / POST / PATCH / DELETE | `/inbox/accounts[/{id}]` | Per-tenant MailAccount CRUD |
| POST | `/inbox/run-workflow` | Manual auto-pipeline run |
| GET | `/inbox/usage` | Tenant LLM usage card data |
| GET / POST / PUT / DELETE | `/jobs[/{id}]` | Job CRUD |
| POST | `/jobs/generate` | LLM auto-fill JD from title |
| GET | `/jobs/{id}/suggested-candidates` | Talent-bank ranking by tag overlap |
| GET / POST | `/candidates[/{id}]` | Candidate CRUD |
| POST | `/candidates/upload` (multipart) | Single CV upload + LLM analysis |
| POST | `/candidates/upload-bulk` (multipart) | Multi-file CV upload |
| POST | `/candidates/parse` (multipart) | Pre-parse a CV without saving |
| GET | `/candidates/{id}/cv-versions[/{vid}/text]` | CV version history + viewer |
| GET | `/candidates/{id}/timeline` | Merged activity timeline |
| GET / POST / PATCH | `/applications[/{id}]` | Application list/detail/stage/notes |
| POST | `/applications/{id}/rescore` | Re-extract resume + re-LLM score |
| POST | `/applications/match` | Manual candidate→job match |
| GET | `/applications/export/csv` | Export filtered applications |

### Screening & interviews

| Method | Path | Description |
| --- | --- | --- |
| POST | `/screening/generate-link` | Create interview link |
| POST | `/screening/send-link` | Email it to candidate |
| GET / POST | `/screening/{app_id}/{links,book-slot,calculate-final-score,send-draft}` | Slot booking + final score |
| GET | `/screening/{app_id}/audio` | Recorded interview audio |
| POST | `/screening/webhook/elevenlabs` | ElevenLabs webhook |

### Reports & metrics

| Method | Path | Description |
| --- | --- | --- |
| GET | `/reports/summary` | Dashboard KPI cards |
| GET | `/reports/funnel` | Pipeline funnel |
| GET | `/reports/top-candidates` | Top scored candidates |
| GET | `/reports/activity` | Recent events feed |
| GET | `/metrics/usage` | Tenant LLM usage breakdown |

### Integrations, comms, calls (Phase 2 + 3)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/integrations` | List all tenant integrations |
| GET / PUT / DELETE | `/integrations/twilio` | Twilio config (auth token write-only) |
| POST | `/integrations/twilio/test` | Send fixed-body test WhatsApp |
| POST | `/communications/whatsapp` | Send WhatsApp to candidate, log it |
| GET | `/communications` | List with filters |
| POST / GET | `/calls[/?candidate_id=&status=&purpose=]` | Enqueue / list calls |
| GET | `/calls/summary` | Tenant call counters |
| POST | `/calls/{id}/cancel` | Soft-cancel pending |
| POST | `/calls/{id}/reschedule` | Mark rescheduled, enqueue new row |
| GET / POST | `/calls/twiml/{id}` | Public — Twilio fetches this |
| POST | `/calls/twilio/status` | Public — Twilio status webhook |

### Billing

| Method | Path | Description |
| --- | --- | --- |
| GET | `/billing/plan` | Current plan + quotas |
| POST | `/billing/checkout` | Stripe Checkout session |
| POST | `/billing/portal` | Stripe Customer Portal |
| POST | `/billing/webhook` | Public — Stripe webhook (signature verified) |

### Super-admin (`/admin/*`)

All require `is_superadmin=True`.

- Tenants: GET / PUT / DELETE / POST (suspend/restore/hard-delete/export)
- Users: GET / GET detail / POST actions (reset-password, disable, mark-verified, grant/revoke superadmin)
- Analytics: GET cross-tenant numbers
- Audit log: GET filtered audit entries
- Platform secrets: GET / PUT / DELETE for env-mirrored secrets

---

## Configuration (env vars)

Loaded at app startup from `backend/.env` (dev) or systemd `EnvironmentFile=` (prod). DB-stored global secrets (`services.secrets.apply_db_secrets_to_env`) override env at boot, so the super-admin can rotate Mistral/ElevenLabs keys via the UI without redeploying.

| Var | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | `postgresql+psycopg2://hireops:pwd@host:5432/hireops` (prod) or default SQLite |
| `JWT_SECRET` | yes | 32-byte hex; used to sign session cookies |
| `MISTRAL_API_KEY` | yes (or DB-stored) | Platform Mistral key |
| `ELEVENLABS_API_KEY` | yes (or DB-stored) | Platform ElevenLabs key |
| `INBOX_SECRET_KEY` | recommended | Fernet root key for per-tenant secret encryption (random fallback warns) |
| `FRONTEND_URL` | yes (prod) | Public URL — used in interview links + email CTAs |
| `BACKEND_PUBLIC_URL` | yes (Phase 3a calls) | Public URL Twilio fetches TwiML from. localhost won't work without ngrok |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_FROM` | yes | Postfix relay |
| `SUPERADMIN_EMAILS` | optional | Comma-separated; auto-promote on signup or boot |
| `SENTRY_DSN` | optional | Error tracking |
| `SENTRY_TRACES_SAMPLE_RATE` | optional | Default 0.1 |
| `ENV` | optional | `development` / `production` (sentry tag) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | only if billing live | Stripe |
| `STRIPE_PRICE_STARTER` / `STRIPE_PRICE_PRO` | only if billing live | Plan price IDs |
| `EMAIL_CLASSIFIER_AGENT_ID` etc | optional | Override Mistral Agent IDs |
| `EMAIL_CLASSIFIER_MOCK=true` | dev | Skip LLM, use keyword fallback |
| `PROFILE_EXTRACTOR_MODEL` | optional | Default `mistral-small-latest` |

Frontend bundle:
- `NEXT_PUBLIC_API_URL` — set BEFORE `npm run build`. Defaults to same-origin `/api/v1`.

---

## Local development

```bash
# 1. Backend
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env  # if you have one, otherwise create per the table above
uvicorn main:app --reload --port 8000

# 2. Frontend (new shell)
cd frontend
npm install
npm run dev   # localhost:3000

# 3. Optional: seed sample data
cd backend && python seed/seed_db.py
```

The backend's `init_db()` creates SQLite tables on first boot, runs migrations, seeds default testimonials, backfills the demo tenant.

---

## Docker (dev)

```bash
docker compose up --build              # all services
docker compose up -d --build           # detached
docker compose logs -f backend         # follow backend logs

# Rebuild after code change (when not using auto-reload)
docker compose up -d --build --force-recreate backend frontend

# Smoke test
curl http://localhost:8000/health
curl -I http://localhost:3000/
```

`docker-compose.yml` runs:
- `db` (Postgres 16, port 5432)
- `backend` (FastAPI, port 8000, mounts `./backend` for hot reload via override)
- `frontend` (Next.js, port 3000)
- `backup` (nightly pg_dump, retains 7 days)

`docker-compose.override.yml` enables backend `--reload`. Disable for prod.

---

## Deployment

Two paths supported:

### A. Docker Compose (prod profile)

`docker-compose.prod.yml` binds backend to `127.0.0.1:8017` and frontend to `127.0.0.1:3017`. Nginx on the host proxies `hireops.symprio.com` → those ports. Full guide: [DEPLOY.md](DEPLOY.md).

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### B. Native VPS (no Docker)

systemd services run uvicorn (backend) and Next.js standalone (frontend) directly on the host. Nginx + certbot from system packages. Full guide: [deploy/NATIVE_DEPLOY.md](deploy/NATIVE_DEPLOY.md).

systemd unit files: [deploy/hireops-backend.service](deploy/hireops-backend.service), [deploy/hireops-frontend.service](deploy/hireops-frontend.service).

Updating a deployed VPS:

```bash
sudo -u hireops -H bash -lc '
  set -e
  cd /opt/hireops && git pull origin main
  cd backend && .venv/bin/pip install -r requirements.txt
  cd ../frontend && npm ci && npm run build
  cp -r public .next/standalone/public 2>/dev/null || true
  cp -r .next/static .next/standalone/.next/static
'
systemctl restart hireops-backend hireops-frontend
```

---

## Operations & troubleshooting

### Health probes

- `GET /health` — basic liveness
- `GET /api/v1/health/db` — verifies DB connection (503 if unhealthy)
- `GET /api/v1/health/llm` — checks Mistral key + SDK loads (no actual API call)

### Common issues

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `502 Bad Gateway` on hireops.symprio.com | Backend not running | `systemctl status hireops-backend`, `journalctl -u hireops-backend -n 100` |
| Inbox shows 8h-old emails despite listener "LISTENING" | Listener task crashed silently (now wrapped in try/except per fix) | `journalctl ... | grep mailbox_listener`; restart backend |
| Dashboard shows 0 candidates after classifier processes 50 emails | Pre-fix: orphaned tenant_id (now backfilled by migration) | `git pull && systemctl restart hireops-backend` |
| Interview link points to `dushy2009-hireops-ai.hf.space` | Pre-fix: hardcoded HF fallback (now defaults to `""`) | Set `FRONTEND_URL` env var; restart backend |
| `npm ci` fails with peer dep error | Lock file stale | Run `npm install` locally to regenerate, commit, redeploy |
| Twilio test message fails with 21659 error | WhatsApp from-number not approved or sandbox not joined | Approve WhatsApp Business sender in Twilio console, or have the test recipient join your sandbox |
| Call queue items stay `pending` forever | `BACKEND_PUBLIC_URL` not set | Set it; localhost won't work — Twilio can't reach it |
| `Connection refused` on `localhost:5432` from backend | Postgres not running | `systemctl start postgresql` (native) or `docker compose up -d db` |
| Pre-flight LLM cost guard blocks all requests | Daily cap exceeded for tenant | Bump plan or wait 24h; visible on Settings → Usage |

### Logs

- Backend: `docker compose logs -f backend` (Docker) or `journalctl -u hireops-backend -f` (native)
- Frontend: `docker compose logs -f frontend` or `journalctl -u hireops-frontend -f`
- Mailbox listener prints `[mailbox_listener]` lines on every successful pickup
- Call queue worker logs to `hireops.call_queue` logger

### Backups (Docker prod)

`backup` service in `docker-compose.yml` runs `pg_dump` nightly, retains 7 daily / 4 weekly / 12 monthly snapshots. Configurable via env vars on the service. Restore via `pg_restore -d hireops /var/backups/.../hireops-2026-05-08.sql.gz`.

For native deploys, see "What's NOT covered" in [deploy/NATIVE_DEPLOY.md](deploy/NATIVE_DEPLOY.md).

---

## File-by-file map

(For quick orientation when something breaks. Also useful for future Claude sessions.)

### Backend hot paths

- [backend/main.py](backend/main.py) — startup hooks, CORS, router registry
- [backend/database.py](backend/database.py) — engine, `init_db`, idempotent migrations, demo tenant backfill, healing of orphaned rows
- [backend/models.py](backend/models.py) — every ORM model (single source of truth)
- [backend/auth/dependencies.py](backend/auth/dependencies.py) — `current_session`, `require_owner`, blocks suspended/disabled users
- [backend/services/workflow_service.py](backend/services/workflow_service.py) — the auto-pipeline (classify → create candidate → match → score → auto-interview)
- [backend/services/mailbox_listener.py](backend/services/mailbox_listener.py) — per-MailAccount poller
- [backend/services/call_queue.py](backend/services/call_queue.py) — phone queue worker + Twilio dispatch
- [backend/services/twilio_service.py](backend/services/twilio_service.py) — Twilio REST adapter
- [backend/services/secrets_crypto.py](backend/services/secrets_crypto.py) — Fernet for tenant secrets
- [backend/billing/cost_guard.py](backend/billing/cost_guard.py) — per-tenant LLM budget contextvar
- [backend/billing/stripe_service.py](backend/billing/stripe_service.py) — checkout / portal / webhook

### Backend agents

- [backend/agents/email_classifier.py](backend/agents/email_classifier.py)
- [backend/agents/resume_scorer.py](backend/agents/resume_scorer.py)
- [backend/agents/profile_extractor.py](backend/agents/profile_extractor.py) — talent-bank tagger (chat API, not an Agent)
- [backend/agents/job_generator.py](backend/agents/job_generator.py)
- [backend/agents/qa_interview.py](backend/agents/qa_interview.py)
- [backend/agents/voice_screener.py](backend/agents/voice_screener.py)
- [backend/agents/interview_evaluator.py](backend/agents/interview_evaluator.py)

### Frontend pages

- `frontend/src/app/(dashboard)/dashboard/page.tsx` — KPIs, funnel, decisions, top candidates
- `frontend/src/app/(dashboard)/inbox/page.tsx` — email list, classify button, auto-pickup status
- `frontend/src/app/(dashboard)/jobs/[jobId]/page.tsx` — job detail + Talent Bank suggestions
- `frontend/src/app/(dashboard)/candidates/[id]/page.tsx` — application detail (the big one)
- `frontend/src/app/(dashboard)/talent-bank/page.tsx` — passive resume pool
- `frontend/src/app/(dashboard)/calls/page.tsx` — phone queue
- `frontend/src/app/(dashboard)/settings/page.tsx` — Twilio integration, demo cleanup, usage
- `frontend/src/app/(public)/interview/[token]/*` — candidate-facing interview rooms
- `frontend/src/app/(admin)/admin/...` — super-admin shell

### Shared frontend

- [frontend/src/lib/api.ts](frontend/src/lib/api.ts) — fetch wrapper, auto-redirect on 401
- [frontend/src/components/auth/AuthGate.tsx](frontend/src/components/auth/AuthGate.tsx)
- [frontend/src/components/layout/DashboardShell.tsx](frontend/src/components/layout/DashboardShell.tsx)
- [frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx)
