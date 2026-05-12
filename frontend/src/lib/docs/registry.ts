/**
 * Docs site registry. Slug → human title + group + short blurb.
 * Section bodies live in /components/docs/sections.tsx.
 * Order is significant — drives sidebar ordering inside each group.
 */

export interface DocEntry {
  slug: string;
  title: string;
  group: string;
  blurb: string;
}

export const DOC_GROUPS = [
  "Getting started",
  "Recruiting",
  "Communication",
  "Reports & insights",
  "Settings",
  "Account",
] as const;

export const DOCS: DocEntry[] = [
  // ── Getting started ──────────────────────────────────────────────────
  {
    slug: "getting-started",
    title: "Signing up & first steps",
    group: "Getting started",
    blurb:
      "Create a workspace, verify your email, complete onboarding, connect your inbox.",
  },
  {
    slug: "dashboard",
    title: "Dashboard tour",
    group: "Getting started",
    blurb: "Every tile on the home screen explained.",
  },
  {
    slug: "search-and-notifications",
    title: "Top-bar search & bell",
    group: "Getting started",
    blurb: "Live candidate search and the notifications feed.",
  },

  // ── Recruiting ────────────────────────────────────────────────────────
  {
    slug: "jobs",
    title: "Creating & managing jobs",
    group: "Recruiting",
    blurb:
      "AI-generate JDs from a title, pick interview mode + question mix, edit and close jobs.",
  },
  {
    slug: "candidates",
    title: "Candidates pipeline",
    group: "Recruiting",
    blurb:
      "Every stage from new → screened → shortlisted, plus candidate detail-page actions.",
  },
  {
    slug: "talent-bank",
    title: "Talent Bank",
    group: "Recruiting",
    blurb:
      "Upload past CVs in bulk, profile tagging, the detail drawer, availability flags.",
  },
  {
    slug: "interviews",
    title: "Interviews",
    group: "Recruiting",
    blurb:
      "AI voice / written Q&A / HR-led video modes, queue tracking, auto-reschedule.",
  },
  {
    slug: "calls",
    title: "Call Queue",
    group: "Recruiting",
    blurb:
      "Schedule outbound calls via Twilio and track outcomes.",
  },

  // ── Communication ────────────────────────────────────────────────────
  {
    slug: "inbox",
    title: "Inbox triage",
    group: "Communication",
    blurb:
      "Auto-classified mail surfaces here — re-classify, link to a candidate, ignore.",
  },
  {
    slug: "outreach",
    title: "Outreach sequences",
    group: "Communication",
    blurb:
      "Multi-touch email + WhatsApp campaigns for talent-bank candidates.",
  },
  {
    slug: "whatsapp",
    title: "WhatsApp bot",
    group: "Communication",
    blurb:
      "Inbound reply intent classification: confirm → auto-link, decline → talent-bank flag.",
  },

  // ── Reports ───────────────────────────────────────────────────────────
  {
    slug: "reports",
    title: "Reports & funnel",
    group: "Reports & insights",
    blurb:
      "Funnel, top candidates, stage distribution. Recruiter-level breakdown on a sub-page.",
  },

  // ── Settings ──────────────────────────────────────────────────────────
  {
    slug: "settings-overview",
    title: "Settings overview",
    group: "Settings",
    blurb: "What lives where on the settings hub.",
  },
  {
    slug: "organization",
    title: "Organization & branding",
    group: "Settings",
    blurb:
      "Company facts that ground AI features + email branding (logo / colour / signature).",
  },
  {
    slug: "templates",
    title: "Email templates",
    group: "Settings",
    blurb:
      "Customise the 11 default email templates with variables and live preview.",
  },
  {
    slug: "pipeline-templates",
    title: "Pipeline templates",
    group: "Settings",
    blurb: "Define your own stages between New and Hired / Rejected.",
  },
  {
    slug: "offer-templates",
    title: "Offer templates",
    group: "Settings",
    blurb: "Salary / equity / benefits boilerplate for the offer letter generator.",
  },
  {
    slug: "team",
    title: "Team & roles",
    group: "Settings",
    blurb: "Invite recruiters, set owner / member roles.",
  },
  {
    slug: "calendar",
    title: "Calendar integration",
    group: "Settings",
    blurb: "Google Calendar — interview slot suggestions skip your busy times.",
  },
  {
    slug: "email-integrations",
    title: "Email integrations",
    group: "Settings",
    blurb: "Gmail / Outlook / Yahoo / iCloud with app passwords.",
  },
  {
    slug: "hris-integrations",
    title: "HRIS / ATS integrations",
    group: "Settings",
    blurb: "Sync candidates and hires with Greenhouse, Lever, Workday, etc.",
  },
  {
    slug: "job-boards",
    title: "Job boards",
    group: "Settings",
    blurb: "Publish open roles to LinkedIn, Indeed, Facebook, MyFutureJobs.",
  },
  {
    slug: "billing",
    title: "Billing & plan",
    group: "Settings",
    blurb: "Upgrade plan, manage payment, view AI usage against your budget.",
  },

  // ── Account ───────────────────────────────────────────────────────────
  {
    slug: "profile",
    title: "Your profile",
    group: "Account",
    blurb: "Display name, password, notification preferences.",
  },
  {
    slug: "support",
    title: "Getting help",
    group: "Account",
    blurb: "Open a support ticket, contextual help drawer, feedback channel.",
  },
];


export function docsByGroup(): Map<string, DocEntry[]> {
  const m = new Map<string, DocEntry[]>();
  for (const g of DOC_GROUPS) m.set(g, []);
  for (const d of DOCS) {
    const list = m.get(d.group);
    if (list) list.push(d);
  }
  return m;
}

export function findDoc(slug: string): DocEntry | undefined {
  return DOCS.find((d) => d.slug === slug);
}
