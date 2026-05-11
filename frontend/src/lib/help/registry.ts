import type { HelpEntry } from "./types";

/**
 * Path patterns → help entries. Patterns are checked top-to-bottom and
 * the FIRST match wins, so put more-specific patterns above general
 * ones. Two pattern types:
 *   - exact string: must equal pathname
 *   - regex: `pathname.match(re)` wins if non-null
 */
interface RegistryEntry {
  match: string | RegExp;
  entry: HelpEntry;
}

const REGISTRY: RegistryEntry[] = [
  // ── Dashboard ────────────────────────────────────────────────────────────
  {
    match: "/dashboard",
    entry: {
      title: "Dashboard",
      what:
        "Real-time view of your hiring funnel: open applications, average resume score, screenings in progress, shortlists, and an AI hiring forecast.",
      highlights: [
        "Counters at the top show the current state of the pipeline.",
        "The Hiring Forecast estimates how many hires you'll close in the next 30–90 days based on conversion rates and average time-in-stage.",
        "The Pipeline Funnel shows where candidates are bunching up — a wide stage means a bottleneck.",
      ],
      howToUse: [
        { text: "Click any counter (e.g. 'Active Screenings') to drill into the underlying list." },
        { text: "Switch the forecast window between 30d / 60d / 90d to model different planning horizons." },
        { text: "Use the global Search box (top-right) to jump straight to a candidate by name or email." },
      ],
      tips: [
        "Forecast says 'using defaults'? You need ~30 stage transitions before the model has enough history. Until then it assumes a 30% per-stage rate.",
      ],
    },
  },

  // ── Inbox ────────────────────────────────────────────────────────────────
  {
    match: "/inbox",
    entry: {
      title: "Inbox & auto-pipeline",
      what:
        "Every email that lands in your connected mailbox is classified by AI. Candidate applications turn into a Candidate + Application row automatically — no manual sorting.",
      highlights: [
        "Email Classifier decides what each message is (candidate, marketing, internal).",
        "Resume Scorer auto-grades the attached CV against the best-matching open job.",
        "If the score clears the threshold, an interview link is generated and emailed back within minutes.",
      ],
      howToUse: [
        { text: "Send a test application to the connected mailbox to see the pipeline run end-to-end." },
        { text: "Click any email to see the classification confidence and AI reasoning." },
        { text: "Failed classifications can be re-categorised manually — the model uses these as future signal." },
      ],
      howToConfigure: [
        { text: "Settings → Mail accounts → Connect Gmail to wire up your team's recruiting inbox." },
        { text: "Plain IMAP / Outlook accounts work too — provide the server + app password." },
      ],
      tips: [
        "The mailbox listener polls every 30s. New emails take ~1 minute to appear.",
        "On the Free plan only the email classifier runs — scoring + voice are unlocked on Starter+.",
      ],
      learnMore: [
        { href: "/settings", label: "Mail account settings", kind: "internal" },
      ],
    },
  },

  // ── Jobs ─────────────────────────────────────────────────────────────────
  {
    match: /^\/jobs\/new$/,
    entry: {
      title: "Create a new job",
      what:
        "Define an open role. Use 'Draft with AI' for Mistral to auto-fill department, location, seniority, skills, responsibilities, qualifications, and a full description — you just provide the title.",
      howToUse: [
        { text: "Type a job title (e.g. 'Senior Backend Engineer')." },
        { text: "Click 'Draft with AI' — the form auto-fills in 2-5 seconds." },
        { text: "Review and tweak any field. Save when ready." },
      ],
      tips: [
        "Once saved, the job auto-publishes nowhere by default. Use the 'Publish to job boards' card on the job detail page to push it to LinkedIn / Facebook / etc.",
      ],
    },
  },
  {
    match: /^\/jobs\/[^/]+\/edit$/,
    entry: {
      title: "Edit job",
      what:
        "Change any job field after creation, set an expiry date, and tune the score thresholds that drive auto-advance / auto-reject.",
      howToUse: [
        { text: "Update fields as needed and click Save." },
        { text: "Set an expiry date if this role has a hard deadline — the auto-pipeline stops matching new applicants after that date." },
        { text: "Adjust score thresholds to make this job more or less selective." },
      ],
      tips: [
        "Default thresholds: resume ≥ 80%, interview ≥ 70%, auto-reject below 40%. Lower them for high-volume roles, raise them for senior hires.",
      ],
    },
  },
  {
    match: /^\/jobs\/[^/]+$/,
    entry: {
      title: "Job detail",
      what:
        "Single source of truth for one open role: applications, interview questions, hiring forecast, talent-bank suggestions, and job-board publishing.",
      howToUse: [
        { text: "Use 'Publish to job boards' to push this job to LinkedIn / Facebook in one click (after connecting them under Settings)." },
        { text: "Interview Questions tab: write or AI-generate custom questions the voice / Q&A agent will ask." },
        { text: "Talent Bank suggestions surface past candidates whose profile matches this job — no email needed." },
        { text: "Close / Reopen the job from the header." },
      ],
      learnMore: [
        { href: "/settings/job-boards", label: "Connect job boards", kind: "internal" },
        { href: "/settings/pipeline-templates", label: "Customise hiring stages", kind: "internal" },
      ],
    },
  },
  {
    match: "/jobs",
    entry: {
      title: "Jobs",
      what:
        "All open and closed roles in your tenant. New applications attach to the best-matching job automatically when emails arrive.",
      howToUse: [
        { text: "Click 'New job' to create a role." },
        { text: "Click any job row to open the detail page where you can publish, edit thresholds, and see applications." },
        { text: "Filter by status to see closed jobs that are hidden by default." },
      ],
    },
  },

  // ── Candidates ───────────────────────────────────────────────────────────
  {
    match: /^\/candidates\/[^/]+$/,
    entry: {
      title: "Candidate detail",
      what:
        "Full record of one applicant: CV, AI score breakdown, fraud signals, interview transcript, history timeline, and every action you can take next.",
      howToUse: [
        { text: "Quick-action toolbar (under the name) jumps to Generate Offer / Call queue / WhatsApp / Fraud signals." },
        { text: "Stage selector at the top moves them through your pipeline. Auto-advance and auto-reject fire based on thresholds." },
        { text: "Re-score uses the latest CV — useful after a candidate uploads v2." },
      ],
      tips: [
        "Fraud signals flag white-on-white text, prompt-injection attempts, and other adversarial CV tricks. Critical signals block scoring until you override.",
      ],
    },
  },
  {
    match: "/candidates",
    entry: {
      title: "Candidates",
      what:
        "Every application across every job in your tenant. Searchable, filterable, exportable.",
      howToUse: [
        { text: "Use the search to find by name / email." },
        { text: "Filter by job, stage, score range, or tag." },
        { text: "Upload CV: drop a PDF in to manually add a candidate without an email." },
        { text: "Bulk select rows to change stage, add tags, or enroll in an outreach sequence." },
      ],
      tips: [
        "Talent Bank (sidebar) shows candidates who don't yet have an application — useful for sourcing.",
      ],
    },
  },

  // ── Talent Bank ──────────────────────────────────────────────────────────
  {
    match: "/talent-bank",
    entry: {
      title: "Talent Bank",
      what:
        "Every candidate ever uploaded to your tenant, regardless of which job they applied for. Use this to source past CVs for new openings.",
      highlights: [
        "AI-extracted profile per candidate (skills, seniority, years of experience, summary).",
        "Tag candidates ('react', 'urgent-follow-up') and filter by tag combinations.",
        "Bulk-enroll into an outreach sequence to reactivate cold leads.",
      ],
      howToUse: [
        { text: "Search semantically (e.g. 'senior react remote') — it matches against extracted profile, not just name." },
        { text: "Click a candidate to open their application detail (if they have one) or view their CV." },
        { text: "Use the 'Show only unassigned' toggle to find candidates with no current application." },
      ],
      tips: [
        "Manually uploaded CVs show a '⏳ Profile pending' badge until the AI extractor finishes — usually under a minute.",
      ],
    },
  },

  // ── Reports ──────────────────────────────────────────────────────────────
  {
    match: "/reports/recruiters",
    entry: {
      title: "Recruiter productivity",
      what:
        "Per-team-member view of recruiting throughput: candidates added, applications progressed, interviews evaluated, offers extended, hires made, and LLM cost.",
      howToUse: [
        { text: "Pick a date range (last 7 / 30 / 90 days)." },
        { text: "Sort by any column to find your top performer." },
        { text: "Export CSV for performance reviews or operations reports." },
      ],
      tips: [
        "LLM Cost column shows AI spend attributable to each recruiter. Background-pipeline costs (auto-scoring) aren't counted against any individual.",
        "If you joined the platform recently, the 'Data starts from' banner shows when attribution began. Older events have no recorded actor.",
      ],
      ownerOnly: true,
    },
  },
  {
    match: "/reports",
    entry: {
      title: "Reports",
      what:
        "Hiring analytics and team productivity. Multiple report types — pick one from the cards below.",
      howToUse: [
        { text: "Pipeline Funnel: where candidates are in the pipeline right now." },
        { text: "Recruiter Productivity: per-team-member throughput." },
        { text: "Time-to-Hire: how long each role takes from posting to offer-signed." },
      ],
    },
  },

  // ── Outreach ─────────────────────────────────────────────────────────────
  {
    match: /^\/outreach\/[^/]+$/,
    entry: {
      title: "Outreach sequence",
      what:
        "Multi-step drip campaign sent to candidates in your Talent Bank. Each step has a delay, a channel (email / SMS / WhatsApp), and merge-tag-aware copy.",
      howToUse: [
        { text: "Drag-reorder steps. Each step has its own delay (in days) from the previous one." },
        { text: "Use merge tags like {{candidate.first_name}}, {{job.title}}, {{recruiter.name}}." },
        { text: "Right-rail enrollment list shows who's currently in the sequence and which step they're on." },
      ],
      tips: [
        "Sequences auto-stop when a candidate replies (the mailbox listener detects it). Set 'Stop on reply' to false if you want to continue regardless.",
      ],
    },
  },
  {
    match: "/outreach",
    entry: {
      title: "Outreach sequences",
      what:
        "Reactivate cold candidates with multi-step email / SMS / WhatsApp drip campaigns. Built-in reply detection auto-stops anyone who responds.",
      howToUse: [
        { text: "Create a sequence with 3-5 steps (e.g. 'day 0 reintro', 'day 3 nudge', 'day 7 last call')." },
        { text: "Bulk-enroll candidates from the Talent Bank selection bar." },
        { text: "The Reply Rate stat shows how effective each sequence is." },
      ],
    },
  },

  // ── Calls ────────────────────────────────────────────────────────────────
  {
    match: "/calls",
    entry: {
      title: "Call Queue",
      what:
        "Twilio-powered automated calling. Add candidates to the queue, the worker dials them with a recorded script, and the disposition (answered / voicemail / no answer) is recorded.",
      howToUse: [
        { text: "Add candidates to the queue from the candidate detail page (Quick Actions → Add to Call Queue)." },
        { text: "The queue worker dials one number every ~60 seconds." },
        { text: "Cancel a queued call before it fires if plans change." },
      ],
      howToConfigure: [
        { text: "Settings → Integrations → Twilio: paste your Account SID, Auth Token, and a verified outbound phone number." },
        { text: "Configure your Twilio number's voice webhook to point at {backend}/api/v1/calls/twiml so the script plays correctly." },
      ],
      tips: [
        "Parallel dialling is OFF by default to keep usage predictable. Change in services/call_queue.py if you need higher throughput.",
      ],
    },
  },

  // ── Support ──────────────────────────────────────────────────────────────
  {
    match: "/support",
    entry: {
      title: "Help & support",
      what:
        "File a ticket if something's broken or you need help, or send the team general feedback (with an optional star rating).",
      howToUse: [
        { text: "Support tickets: subject + description + category + priority. Owner team replies inline." },
        { text: "Send feedback: optional 1-5 star rating + a short message. No reply expected." },
        { text: "Both surfaces are tenant-private — only your team sees your own tickets." },
      ],
      tips: [
        "For urgent production issues use 'Urgent' priority — it's surfaced to platform admins ahead of normal traffic.",
      ],
    },
  },

  // ── Settings (sub-pages first, then root) ────────────────────────────────
  {
    match: "/settings/team",
    entry: {
      title: "Team",
      what:
        "Invite teammates, change roles, revoke pending invites. Up to your plan's seat limit.",
      howToUse: [
        { text: "'Invite member' → enter email + role (owner / member). They get a single-use link valid for 7 days." },
        { text: "Revoke pending invites if the recipient won't accept." },
        { text: "Promote a member to owner — owners can see billing + change the plan, members cannot." },
      ],
      ownerOnly: true,
    },
  },
  {
    match: "/settings/billing",
    entry: {
      title: "Billing & usage",
      what:
        "Your current plan, today's AI spend bar, and the upgrade flow. Stripe Checkout handles payment in test or live mode depending on what your platform admin configured.",
      howToUse: [
        { text: "Click 'Upgrade to Pro' / 'Starter' to launch Stripe Checkout." },
        { text: "Use test card 4242 4242 4242 4242 if you're in sandbox mode." },
        { text: "The AI spend bar resets at midnight UTC." },
      ],
      ownerOnly: true,
    },
  },
  {
    match: "/settings/job-boards",
    entry: {
      title: "Job boards",
      what:
        "Connect LinkedIn, Facebook, Indeed, MyFutureJobs etc. once and every job's 'Publish' panel can push to all of them in one click.",
      howToUse: [
        { text: "Click 'Sign in with LinkedIn' / 'Sign in with Facebook Page'. You'll be redirected to the provider, sign in, and grant page-admin permissions." },
        { text: "After OAuth, pick which Page to publish under (if you admin more than one)." },
        { text: "For providers without OAuth (Mock, MyFutureJobs), paste credentials in the manual form." },
      ],
      howToConfigure: [
        { text: "Platform admin must register an app with each provider AND set LINKEDIN_APP_CLIENT_ID / FACEBOOK_APP_ID env vars before the 'Sign in' buttons unlock." },
      ],
      tips: [
        "Apps need provider review (LinkedIn / Meta) before non-developer users can authorise. Until then, only accounts you've whitelisted on the provider's developer console can sign in.",
      ],
      ownerOnly: true,
    },
  },
  {
    match: "/settings/hris-integrations",
    entry: {
      title: "HRIS / ATS integrations",
      what:
        "Two-way sync with HR systems (Greenhouse, Lever, Workday, Merge.dev). Pulls jobs / candidates / applications IN; pushes candidate state changes OUT.",
      howToUse: [
        { text: "Click 'Connect' on a provider card. Mock provider works out of the box for demos." },
        { text: "Once connected, click 'Sync now' for an immediate pull. The background worker also polls every 15 minutes." },
        { text: "View per-sync history in the connection drawer." },
      ],
      tips: [
        "Real providers (Greenhouse, Lever, Workday) need partner credentials. Merge.dev is the recommended path for breadth.",
      ],
      ownerOnly: true,
    },
  },
  {
    match: "/settings/pipeline-templates",
    entry: {
      title: "Pipeline templates",
      what:
        "Define custom hiring stages (e.g. 'phone screen → take-home → onsite → offer') and assign each template to specific jobs.",
      howToUse: [
        { text: "Default template ships with 7 standard stages. Don't rename it — clone it to build your own." },
        { text: "Drag stages to reorder. Set 'terminal_outcome' to 'hired' or 'rejected' on the final stages." },
        { text: "Assign a template to a job on the job edit page." },
      ],
    },
  },
  {
    match: "/settings/offer-templates",
    entry: {
      title: "Offer templates",
      what:
        "Markdown-based offer letter templates with merge tags. One template can serve many jobs.",
      howToUse: [
        { text: "Create a template with placeholders like {{candidate.first_name}}, {{job.title}}, {{start_date}}, {{salary}}." },
        { text: "Generate offers from the candidate detail page — pick a template and fill the merge values." },
        { text: "Candidates sign or decline at a public URL — no login needed." },
      ],
    },
  },
  {
    match: "/settings",
    entry: {
      title: "Settings",
      what:
        "Top-level configuration hub. Each card jumps to a sub-page for a specific area (team, billing, integrations, templates, etc).",
      howToUse: [
        { text: "Click a card to dive in." },
        { text: "Owner-only sections (Billing, Team) are gated — members see them as read-only." },
      ],
    },
  },

  // ── Admin pages ──────────────────────────────────────────────────────────
  {
    match: /^\/admin\/tenants\/[^/]+$/,
    entry: {
      title: "Tenant detail",
      what:
        "Per-tenant management: members, plan, billing, integrations status, 30-day LLM spend, audit log, soft-delete / restore.",
      howToUse: [
        { text: "Change plan / quota overrides directly from the header." },
        { text: "Impersonate (1h session, requires written reason) for support tasks." },
        { text: "Export metadata for compliance — does NOT include candidate / CV / transcript data." },
      ],
      tips: [
        "Impersonation writes a critical-severity audit row. Tenant administrators see when their data was accessed.",
      ],
      superAdminOnly: true,
    },
  },
  {
    match: "/admin/stripe",
    entry: {
      title: "Stripe credentials",
      what:
        "Two parallel credential sets (sandbox + production). A toggle decides which one is live; you can switch without losing the other.",
      howToUse: [
        { text: "Paste secret key, publishable key, webhook signing secret, and two Price IDs (starter + pro)." },
        { text: "Click 'Test connection' to verify each value against Stripe before saving." },
        { text: "Toggle mode (sandbox / production) and Save." },
      ],
      tips: [
        "Price IDs start with `price_...` NOT `prod_...`. Find them on the Stripe product page → Pricing row → '...' → Copy price ID.",
      ],
      superAdminOnly: true,
    },
  },
  {
    match: "/admin/plans",
    entry: {
      title: "Plan editor",
      what:
        "Override default plan settings (price, quotas, allowed agents) without redeploying. Stored in the `settings` table.",
      howToUse: [
        { text: "Edit any plan; changes go live within 30 seconds (cache TTL)." },
        { text: "Toggle 'All agents allowed' for Pro-like behavior, or pick individual agents." },
        { text: "Reset to defaults to remove your override." },
      ],
      superAdminOnly: true,
    },
  },
  {
    match: "/admin/support",
    entry: {
      title: "Support & feedback (admin)",
      what:
        "Triage tenant-raised tickets and read product feedback. You only see what tenants explicitly typed here — no candidate / CV data leaks in.",
      howToUse: [
        { text: "Filter by status + priority. Expand a ticket to read the description, change status, write a reply." },
        { text: "Replies land on the tenant's /support page immediately." },
        { text: "Feedback tab shows CSAT / NPS averages and per-entry triage state." },
      ],
      superAdminOnly: true,
    },
  },
  {
    match: "/admin/audit-log",
    entry: {
      title: "Audit log",
      what:
        "Every privileged action across every tenant. Filter by action type, tenant, or actor email.",
      howToUse: [
        { text: "Tenant-targeting rows show REDACTED payloads (just key names, no values) so cross-tenant browsing can't read private content." },
        { text: "Super-admin actions show full payloads — those are platform events, not tenant-private." },
        { text: "Use the action filter to zero in on 'tenant.impersonate', 'plan_change', etc." },
      ],
      superAdminOnly: true,
    },
  },
  {
    match: "/admin/analytics",
    entry: {
      title: "Platform analytics",
      what:
        "Aggregate growth + revenue + cost dashboards. Tenant growth, MRR, conversion, top spenders, per-agent LLM breakdown.",
      howToUse: [
        { text: "Numbers refresh on every load — no scheduled job needed." },
        { text: "Past-due tenants list shows anyone whose Stripe subscription failed." },
      ],
      superAdminOnly: true,
    },
  },
  {
    match: "/admin/settings",
    entry: {
      title: "Platform settings",
      what:
        "Platform-wide AI agent configuration, global LLM usage report, platform secrets, environment check.",
      howToUse: [
        { text: "Agent Configuration tab: toggle individual agents, set mock mode, see model assignments." },
        { text: "LLM Usage Report: aggregate spend across all tenants. Pick 24h / 7d / 30d window." },
        { text: "System tab: env-var check + system metadata." },
      ],
      superAdminOnly: true,
    },
  },
  {
    match: /^\/admin/,
    entry: {
      title: "Platform Admin",
      what:
        "The super-admin control plane. Manage tenants, users, plans, Stripe, support tickets, audit log, and platform settings.",
      howToUse: [
        { text: "Use the sidebar to navigate between admin sections." },
        { text: "Every privileged action writes to the audit log automatically." },
      ],
      superAdminOnly: true,
    },
  },
];

const FALLBACK: HelpEntry = {
  title: "This page",
  what:
    "We haven't written contextual help for this page yet. Try the in-app tour (Topbar → ? icon → 'Take a tour') or send us feedback via Help & Support.",
  howToUse: [
    { text: "Most actions in HireOps have a tooltip on hover — try hovering buttons and icons." },
    { text: "Settings pages have inline descriptions explaining what each toggle does." },
  ],
  learnMore: [
    { href: "/support", label: "Send feedback", kind: "internal" },
  ],
};

export function resolveHelp(pathname: string): HelpEntry {
  for (const r of REGISTRY) {
    if (typeof r.match === "string") {
      if (pathname === r.match) return r.entry;
    } else if (r.match.test(pathname)) {
      return r.entry;
    }
  }
  return FALLBACK;
}
