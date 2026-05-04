# Super-Admin Roadmap

What you (Symprio team) need to operate HireOps AI at scale: support customers,
debug issues, charge people correctly, and not get burned by abuse.

> **Read first, then we build.** Each item ends with a one-line **why now / why later**
> so you can prioritize. Answer the **Decisions** at the bottom and I'll convert
> the picks to a tracked TODO list.

---

## Where we are today (Phase 2 — already shipped)

The super-admin you have right now:

| Endpoint | What it does |
|---|---|
| `GET /api/v1/admin/tenants` | List every tenant with usage counts |
| `GET /api/v1/admin/tenants/{id}` | Single tenant detail (lightweight) |
| `POST .../{id}/suspend` | Toggle suspension (suspended tenants can't log in) |
| `POST .../{id}/impersonate` | Issue a 24h session for the tenant's owner |

UI: `/admin` route, sidebar link only when `is_superadmin = true`. Promotion
via `SUPERADMIN_EMAILS` env var or `scripts/make_superadmin.py`.

That's enough to suspend a bad actor or login-as a customer to debug. Everything
else is missing.

---

## What's missing — by category

### A. Tenant deep-dive (high value, easy)

Without this, the list is decorative — you can't actually *do* anything per-tenant.

**A1 — Tenant detail page**
- Drill into a single tenant: members, jobs, candidates, applications, interviews
- Link to recent activity (last 30 day events)
- Show Stripe subscription state, current period end, payment method status
- LLM spend chart (last 30 days, daily granularity)
- Suspend / reactivate / delete buttons

**A2 — Edit tenant**
- Change plan manually (e.g. comp a customer to Pro for a month)
- Override quotas (max_jobs / max_candidates / max_interviews_per_month)
- Override LLM daily budget per-tenant
- Edit name/slug
- Reset Stripe customer (in case of weird state)

**A3 — Tenant search + filter**
- Search by name, slug, owner email
- Filter by plan / suspended / "no activity 30+ days" / "over quota"
- Sort by created_at, last_activity, candidate_count, MRR

> **Why now**: you can't run support without these. **A1 + A2** are day-1 essentials.

---

### B. User management (medium value)

**B1 — All-users table**
- List every user across every tenant
- Filter by email-verified / role / tenant
- Last login, signup date

**B2 — User actions**
- Reset password (sends them a fresh reset link)
- Disable/enable an individual user (without suspending whole tenant)
- Promote/demote between `owner` and `member` within a tenant
- Manually mark email_verified (for support cases)
- Force logout (invalidate JWTs by rotating user-specific salt — needs schema change)

**B3 — Super-admin management**
- Add/remove super-admins via UI (instead of editing env var + restart)
- Audit who promoted whom and when

> **Why now**: B1 is helpful for support. B2 is for "I locked myself out" tickets.
> B3 is ops hygiene — only matters once 2+ Symprio team members exist.

---

### C. Platform analytics (high value, medium effort)

**C1 — Growth dashboard**
- New signups per day (chart)
- Total active tenants (DAU/WAU/MAU)
- Free → paid conversion %
- Churn (paid → free or fully canceled)
- Time-to-first-action (signup → first job → first interview)

**C2 — Revenue dashboard**
- MRR (Monthly Recurring Revenue)
- Active subscriptions by plan
- Failed payment list (past_due tenants)
- Stripe webhook delivery status (which webhooks failed)

**C3 — Cost analytics**
- Total LLM spend across all tenants per day
- Top spenders (which tenants use most LLM)
- Per-agent cost breakdown (resume scoring vs Q&A vs interview eval)
- ElevenLabs minute consumption (when wired)
- Cost-per-tenant ratio (MRR / LLM spend → which tenants are unprofitable)

> **Why now**: Without this you're flying blind. C1 and C3 are the most
> important — C1 tells you if the product is working, C3 tells you if you're
> losing money.

---

### D. Audit + compliance (low effort, important)

**D1 — Super-admin audit log**
- Every privileged action recorded: who, what, when, target tenant, IP
- Actions covered: suspend, impersonate, plan change, quota override, user disable
- Append-only, exportable CSV

**D2 — Tenant data export**
- "Download all data" button per tenant — gives them (or you) a ZIP with
  jobs/candidates/applications/transcripts as CSV/JSON
- Required for GDPR data-portability requests

**D3 — Tenant data deletion**
- "Delete tenant" — irreversible, removes all rows tagged with their tenant_id
- Required for GDPR right-to-be-forgotten
- Soft-delete first (mark deleted_at), hard-delete after 30 days

> **Why now**: D1 is one DB table + one filter. D2/D3 you only need when
> someone asks — but better to have them ready before that lawyer email lands.

---

### E. Operational tools (varied)

**E1 — Maintenance mode**
- Global flag: when on, signup is blocked + every page shows a banner
- Optional per-tenant flag (suspend without deleting their data)

**E2 — Broadcast announcements**
- Post a banner that every logged-in user sees ("New feature: ..." / "Scheduled maintenance ...")
- Dismissable + targetable (all / paid plans only / specific tenants)

**E3 — Custom email sender**
- Send a one-off email to a specific user or every user in a plan tier
- Useful for: "your trial expires in 3 days", manual outreach

**E4 — System health page**
- Public-ish status page at `/status` (or admin-only)
- DB / LLM / SMTP / Stripe webhook last-success heartbeat

**E5 — Webhook dispatch viewer**
- See every Stripe webhook received, raw payload, applied/failed
- Replay button for failed ones

> **Why now**: E4 is 1 page of work and saves you from "is it just me?"
> support tickets. The rest are nice-to-haves until you have ~50 tenants.

---

### F. Trust & Safety (varies, do when needed)

**F1 — Abuse signals**
- Tenants flagged automatically if: signup IP matches another suspended tenant,
  signup → 100 candidates in 1 hour, LLM spend hits cap repeatedly
- Surfaced as a warning badge in the tenants list

**F2 — Rate-limit overrides**
- Per-tenant tighter rate limits when abuse suspected

**F3 — Ban list**
- Block specific email domains, IPs, or VOIP numbers from signup

> **Why now**: only matters once you have abuse to react to. Skip until
> someone tries to use you for a phishing campaign.

---

### G. Developer / internal tools (low priority, fun)

**G1 — Read-only SQL console**
- Run SELECT-only queries against the DB from the admin UI
- Saved query library

**G2 — Background-job dashboard**
- Once we add a queue (RQ/Celery), surface job status

**G3 — Internal API tokens**
- Issue tokens that hit admin endpoints from scripts

> **Why now**: skip until something forces you to.

---

## Priority cheat-sheet

If I had to recommend the order:

| Order | Feature | Why |
|---|---|---|
| 1 | A1 Tenant detail page | Useless to list without drilling |
| 2 | A2 Edit tenant (plan + quotas) | Comp accounts, fix billing edge cases |
| 3 | A3 Search + filter | Becomes painful at >20 tenants |
| 4 | C1 Growth dashboard | Know if the product is working |
| 5 | C3 Cost analytics | Know if you're losing money |
| 6 | D1 Audit log | Cheap insurance |
| 7 | C2 Revenue dashboard | When you have any paying customers |
| 8 | E4 System health page | Stops "is it down?" tickets |
| 9 | B1 All-users table | Support efficiency |
| 10 | B2 User actions (reset password) | Inevitable support tickets |
| 11 | D2 Tenant data export | First GDPR request |
| 12 | D3 Tenant data deletion | GDPR right-to-be-forgotten |
| 13 | E1 Maintenance mode | Before first big migration |

That's roughly 2 weeks of solid work for one engineer. We can ship 1–4 first
as a milestone (the "operate the product" pack), then 5–8 (the "understand
the product" pack), then 9–13 (the "scale support" pack).

---

## Open decisions

Answer these and I'll convert your picks into tracked tasks:

1. **Which milestone first?** "Operate" (1–4) / "Operate + Understand" (1–7) / something custom
2. **Who else gets super-admin?** Just you? Two of you? — drives B3 priority
3. **Audit log retention** — 12 months, forever, configurable?
4. **Tenant deletion policy** — instant hard-delete on superadmin click, or
   30-day soft-delete window with restore button?
5. **Custom email tool (E3)** — useful for manual outreach? Or wait until you
   have a real CRM?
6. **Status page (E4)** — internal admin-only, or public at `/status`?
   (Public builds trust but exposes outage info to competitors.)

---

## What I'd build first if you say "go"

**Milestone 1 — "Operate" pack** (about 1 week):

1. **Tenant detail page** (`/admin/tenants/[id]`):
   - Members table
   - Recent jobs / candidates / applications counts with sparklines
   - LLM spend chart (last 30d)
   - Edit fieldset: plan + quota overrides + manual subscription state
   - Suspend / Delete actions with confirmation

2. **Tenant search + filter** on the existing list page:
   - Search box (name, slug, owner email)
   - Filter chips (plan, suspended, no activity)

3. **Audit log foundation** (single table + decorator):
   - Wrap the existing super-admin endpoints to record every action
   - View at `/admin/audit-log` with filters

4. **Edit-tenant endpoints**:
   - `PATCH /admin/tenants/{id}` — update plan, quotas, name
   - `DELETE /admin/tenants/{id}` — soft-delete with `deleted_at` flag

That gives you everything needed to run support and tweak edge cases. The
analytics dashboards (Milestone 2) come next.

---

Tell me which milestone (or which subset) you want to tackle, and I'll start
building. Or override the priorities — your call.
