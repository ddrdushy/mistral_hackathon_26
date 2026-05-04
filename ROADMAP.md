# HireOps AI — Public SaaS Roadmap

Plan to take HireOps AI from a single-tenant hackathon demo to a multi-tenant
public SaaS at **hireops.symprio.com** with admin, tenants, and billing.

> **Read first, then we build.** Every section ends with **Decisions to make** — answer
> those and the implementation order falls out of itself.

---

## Phase 0 — Architecture decisions (lock these before coding)

| Decision | Recommendation | Why |
|---|---|---|
| **Hosting** | VPS (Docker Compose) | You already have it. Postfix already configured. One bill, full control. |
| **Database** | Postgres on the VPS (already in `docker-compose.yml`) | Multi-tenant SQLite is fragile under concurrency. Postgres handles row-locking, JSONB, real backups. |
| **Reverse proxy** | Caddy or Nginx in front of the stack | Caddy auto-renews HTTPS via Let's Encrypt, Nginx is more battle-tested. Caddy if greenfield. |
| **Auth** | Roll our own with `argon2` + JWT cookies | Fewer dependencies than Clerk/Auth0, no external bill, full control. ~250 lines of FastAPI. |
| **Multi-tenancy model** | Row-level (`tenant_id` column on every table) | Simpler than schema-per-tenant. Backups are one DB. Query scoping via SQLAlchemy event listeners or explicit filters. |
| **Tenant URL strategy** | Path-based first: `hireops.symprio.com/t/{tenant_slug}/...` | Subdomains require wildcard SSL + DNS automation. Path-based works on day 1; we can swap to subdomains later without changing schema. |
| **Email** | Postfix on VPS via SMTP localhost | You said it's configured. Free, no rate limits, no signup. Use a dedicated `noreply@hireops.symprio.com` sender. |
| **Billing** | Stripe Checkout + Customer Portal + Webhooks | Industry standard. Don't build your own. ~150 lines of integration. |
| **Background jobs** | Defer to Phase 5 | Synchronous works for v1. When Mistral calls slow down the signup flow, add a job queue (RQ or Celery). |
| **Frontend hosting** | Same VPS, served by Next.js node server in Docker | One deploy unit. Caddy proxies `/api` → backend, everything else → Next.js. |

### Decisions to make
- [ ] OK to roll our own auth, or do you want NextAuth.js / Clerk / Supabase?
- [ ] Path-based tenant URLs OK for v1, or do you want subdomains immediately?
- [ ] Caddy or Nginx for the reverse proxy?

---

## Phase 1 — Auth + Multi-tenancy (the foundation, can't ship without)

**Goal**: A logged-in user only sees their own tenant's data.

### 1.1 Schema additions
- New tables: `tenants`, `users`, `user_tenants` (many-to-many for future multi-org membership), `sessions` (or use JWT, no sessions table)
- Add `tenant_id` (FK → tenants) to every existing table that holds tenant data:
  - `jobs`, `emails`, `candidates`, `applications`, `events`, `interview_links`, `qa_sessions`, `settings`
- Create unique constraint on `(tenant_id, candidate_email, job_id)` etc. so the same email can apply to different tenants

### 1.2 Auth flow
- `POST /api/v1/auth/signup` — creates user, creates tenant, sends verification email via Postfix
- `POST /api/v1/auth/verify-email` — token from email
- `POST /api/v1/auth/login` — returns JWT in HttpOnly cookie
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/forgot-password` + `/reset-password`
- Password hashing: `argon2-cffi`
- JWT: 7-day expiry, sliding refresh on activity, HttpOnly + Secure + SameSite=Lax cookie

### 1.3 Authorization middleware
- FastAPI dependency `current_user_and_tenant()` that:
  - Reads JWT from cookie
  - Loads user + tenant from DB
  - Raises 401 if invalid
  - Returns `(user, tenant)` tuple to handlers
- Every existing endpoint gets this dependency added
- All DB queries filter by `tenant_id = tenant.id`
- A SQLAlchemy event listener can enforce this defensively (defence in depth)

### 1.4 Frontend
- New routes: `/signup`, `/login`, `/forgot-password`, `/reset-password`, `/verify-email`
- Middleware redirects unauth'd users hitting `/dashboard/*` to `/login`
- API client adds cookie credentials automatically
- Logout button in topbar (replace the static "HR" avatar with a real menu)

### Decisions to make
- [ ] Free signup, or invite-only / waitlist for the first weeks?
- [ ] Password requirements: min length 8 / 12 / require special chars?
- [ ] One user = one tenant, or allow users to belong to multiple tenants? (One is simpler for v1.)

---

## Phase 2 — Admin (super-admin + tenant admin)

Two distinct admin layers:

### 2.1 Super-admin (you / Symprio team)
- Hidden role, set via DB flag `users.is_superadmin = true`
- New `/admin` route, only accessible if `is_superadmin`
- Capabilities:
  - List all tenants with usage (candidates count, last activity, plan)
  - Suspend / reactivate a tenant
  - Impersonate a tenant ("login as" for support) — important for debugging
  - View global usage and billing summary
  - Manually adjust a tenant's quota or plan
- Audit log for all super-admin actions

### 2.2 Tenant admin (per-tenant owner)
- Roles: `owner` (created the tenant), `member` (invited)
- Owner can:
  - Invite team members (by email, via Postfix)
  - Remove team members
  - Configure tenant settings (company name, logo, default thresholds)
  - View billing / change plan
- Member can:
  - Use everything HireOps does today
  - Cannot manage billing or invite

### Decisions to make
- [ ] Just `owner + member` for v1, or do you want full RBAC (`admin`, `recruiter`, `viewer`)?
- [ ] Should super-admin be a separate flag, or its own UI domain (`admin.hireops.symprio.com`)?
- [ ] Who from Symprio gets super-admin? Just you?

---

## Phase 3 — Billing (Stripe)

### 3.1 Plans
| Plan | Price | Limits |
|---|---|---|
| **Free** | $0 | 5 jobs, 25 candidates, 10 Q&A interviews/mo, 50 voice min/mo, no Mistral overage |
| **Starter** | TBD/mo | 25 jobs, 250 candidates, 100 interviews/mo, branded emails |
| **Pro** | TBD/mo | Unlimited jobs/candidates, unlimited interviews, priority support, SSO |

### 3.2 Stripe integration
- Stripe Customer per tenant (created on signup with placeholder, no card)
- Stripe Checkout session for upgrade
- Stripe Customer Portal for self-service plan changes / cancellations
- Webhook endpoint `POST /api/v1/billing/stripe-webhook` listens for:
  - `checkout.session.completed` → upgrade tenant
  - `customer.subscription.updated` → reflect plan changes
  - `customer.subscription.deleted` → downgrade to Free
  - `invoice.payment_failed` → email + grace period
- Tenant table fields: `plan`, `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, `current_period_end`

### 3.3 Quota enforcement
- Helper `enforce_quota(tenant, "candidates")` raises 402 (Payment Required) when over
- Frontend shows usage bars: "23/25 candidates · upgrade to add more"
- Quota counters cached per-tenant, recomputed nightly

### 3.4 Trial
- Optional 14-day Pro trial on signup (no card required)
- Auto-downgrades to Free at end of trial unless they upgrade

### Decisions to make
- [ ] Final pricing for Starter and Pro?
- [ ] Trial: yes/no, length, requires card or not?
- [ ] Annual billing discount? (typical: 2 months free)
- [ ] Currency: USD only, or multi-currency from day 1?

---

## Phase 4 — Public-facing pages

### 4.1 Marketing site at `/`
- Landing page: hero, features, screenshot/video, pricing teaser, "Sign up free" CTA
- `/pricing` — plan comparison table, FAQ
- `/about` — short company blurb (defer if low priority)
- `/changelog` — what's shipped (good for SEO, builds trust)

### 4.2 Legal (required to collect emails)
- `/legal/privacy` — privacy policy
- `/legal/terms` — terms of service
- `/legal/cookies` — cookie policy
- Cookie consent banner (only needs to be shown to EU IPs, but most teams show it everywhere)

### 4.3 SEO basics
- OG meta tags on every public page
- `sitemap.xml` and `robots.txt`
- Title / meta description per page
- Static rendering for marketing pages (Next.js does this by default)
- 1 OG image with the product screenshot

### Decisions to make
- [ ] Do you have brand assets (logo, primary colors, font) or should we keep current visual identity?
- [ ] Marketing copy: do you want me to draft it, or will you provide it?
- [ ] Do you want a blog/changelog from day 1?

---

## Phase 5 — Production hardening

### 5.1 Cost guards (highest priority — protects you from runaway bills)
- **Per-tenant Mistral spend cap**: track tokens × $/token per tenant per day; soft-pause at 80% of plan budget
- **Per-tenant ElevenLabs minute cap**: same idea
- **Global daily budget kill-switch**: env var, blocks all LLM/voice if total daily spend > threshold
- **Concurrency limit**: max 5 LLM calls in-flight per tenant; queue or 429 the rest

### 5.2 Observability
- **Sentry** (free tier: 5k events/mo) for error tracking, both frontend + backend
- **Structured logs** with `tenant_id` on every log line for fast tenant-scoped debugging
- **Health endpoints**: `/api/v1/health` exists; add `/api/v1/health/db` and `/api/v1/health/llm`
- **Status page** at `status.hireops.symprio.com` — simplest: static HTML pinged by uptime check, fancier: instatus.com or similar

### 5.3 Backups
- `pg_dump` nightly to a separate VPS path or S3
- 7 daily, 4 weekly, 12 monthly retention
- One restore drill before launch — confirm backups actually restore

### 5.4 Demo data seeding
- New tenant gets 2 sample jobs, 5 sample candidates with resumes, 1 completed Q&A interview, 1 voice interview transcript
- Lets them see what the dashboard looks like populated, builds confidence in the product
- Show "These are demo records" banner with "Clear demo data" button

### 5.5 Rate limiting
- `slowapi` middleware (FastAPI compat with Flask-Limiter)
- Tiers: 100 req/min anonymous, 600 req/min authenticated, 6000 req/min Pro
- Apply globally + tighter limits on auth endpoints (5/min for login, 1/min for forgot-password)

### Decisions to make
- [ ] Sentry, Logtail, Axiom, or self-hosted Loki?
- [ ] Backup target: VPS local + offsite (S3 / Backblaze) or VPS only?
- [ ] Demo data on every signup, or opt-in?

---

## Phase 6 — Polish & launch readiness

- Onboarding checklist on first login: connect Gmail → create first job → upload first resume
- Empty-state CTAs everywhere (Inbox, Jobs, Candidates list)
- Mobile responsive review (current dashboard is desktop-first)
- Performance audit: Lighthouse score, lazy-load heavy pages
- A11y pass: keyboard nav, contrast, screen reader labels
- Smoke-test checklist for deploys
- Pre-launch security review: OWASP top 10 quick pass

---

## Suggested execution order (week-by-week)

| Week | Goal | Deliverables |
|---|---|---|
| **1** | Auth + tenancy spine | DB migration, signup/login/verify, query scoping, tenant_id everywhere. Existing demo still works. |
| **2** | Admin + invites | Super-admin panel, tenant invite flow, owner/member roles, "login as" support tool |
| **3** | Stripe + plans | Free/Starter/Pro, quota enforcement, Customer Portal, webhook handler, usage UI |
| **4** | Marketing + legal | Landing page, pricing, privacy/terms/cookies, sign-up CTA, basic SEO |
| **5** | Hardening | Sentry, backups, rate limits, cost caps, demo seeding, status page |
| **6** | Launch prep | Onboarding flow, polish, mobile responsive, security review, soft launch to friends |
| **7** | Public launch | DNS cutover to hireops.symprio.com, monitor errors / spend / signups |

Any phase can run in parallel with the next once we have the schema/auth foundation.

---

## What I'd skip for v1

These get postponed until you have signal that they matter:

- **SSO (Google/Microsoft)** — add after first 50 signups complain
- **Webhooks for tenants** — they barely have data, no need to push it elsewhere
- **API tokens for tenants** — same reason
- **Custom branding per tenant** — Pro feature later
- **GDPR data export / right-to-be-forgotten** — needed eventually, not blocker for launch
- **SOC 2** — premature; revisit once you have paying customers asking for it
- **Mobile app** — web is fine
- **Internationalization** — English only at launch, add when you have a non-English customer

---

## Open questions for you

Roll up of all "Decisions to make" above:

1. **Auth** — roll our own, or use NextAuth/Clerk/Supabase?
2. **Tenant URLs** — `/t/{slug}` (path) or `{slug}.hireops.symprio.com` (subdomain)?
3. **Reverse proxy** — Caddy or Nginx?
4. **Signup model** — open signup, invite-only waitlist, or both?
5. **Roles** — `owner + member`, or full `admin/recruiter/viewer`?
6. **Pricing** — what are Starter and Pro prices?
7. **Trial** — yes/no, length, card required?
8. **Brand assets** — provide or generate?
9. **Marketing copy** — provide or I draft?
10. **Observability stack** — Sentry only, or also Logtail/Axiom?
11. **Backup target** — VPS-local only, or also S3/Backblaze?
12. **Super-admins** — just you, or a list of emails?

Answer those (even partially) and I'll convert this into a tracking issue list and start Phase 1.
