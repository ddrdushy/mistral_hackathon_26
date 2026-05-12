/**
 * Docs site registry. Each entry maps a URL slug → human title + group
 * + short blurb. The actual page content lives in
 * `/components/docs/sections/{slug}.tsx` so we can keep MDX-style
 * structure without pulling in an MDX toolchain.
 *
 * Order is significant — it drives sidebar ordering inside each group.
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
  "Settings",
] as const;

export const DOCS: DocEntry[] = [
  // Getting started
  {
    slug: "getting-started",
    title: "Signing up & first steps",
    group: "Getting started",
    blurb:
      "Create a workspace, complete the onboarding profile, and connect your inbox in under five minutes.",
  },
  {
    slug: "dashboard",
    title: "Dashboard tour",
    group: "Getting started",
    blurb: "What every panel on the home screen tells you and what to do next.",
  },

  // Recruiting
  {
    slug: "jobs",
    title: "Creating & managing jobs",
    group: "Recruiting",
    blurb:
      "Generate a JD with one click, pick interview mode + question mix, manage the job's pipeline.",
  },
  {
    slug: "candidates",
    title: "Candidates pipeline",
    group: "Recruiting",
    blurb:
      "How a candidate moves from new → screened → shortlisted, plus how to use the detail page actions.",
  },
  {
    slug: "talent-bank",
    title: "Talent Bank",
    group: "Recruiting",
    blurb:
      "Upload past CVs, surface profiles for new roles, send bulk availability checks.",
  },
  {
    slug: "interviews",
    title: "Interviews",
    group: "Recruiting",
    blurb:
      "Pick AI voice, written Q&A, or HR-led video. Track who's pending and auto-handle reschedule requests.",
  },

  // Communication
  {
    slug: "outreach",
    title: "Outreach & WhatsApp",
    group: "Communication",
    blurb:
      "Email + WhatsApp from the candidate timeline, plus inbound replies and auto-link send.",
  },
  {
    slug: "inbox",
    title: "Inbox triage",
    group: "Communication",
    blurb:
      "How auto-classified emails surface here and what happens when you mark one as a candidate.",
  },

  // Settings
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
      "Company profile fields that ground AI features in your real business, plus email branding.",
  },
  {
    slug: "templates",
    title: "Email templates",
    group: "Settings",
    blurb:
      "Customise interview invite, offer letter, rejection, and seven more templates with live preview.",
  },
  {
    slug: "team",
    title: "Team & roles",
    group: "Settings",
    blurb: "Invite recruiters, set roles, transfer ownership.",
  },
  {
    slug: "calendar",
    title: "Calendar integration",
    group: "Settings",
    blurb: "Connect Google Calendar so interview slots avoid your existing meetings.",
  },
  {
    slug: "billing",
    title: "Billing & plan",
    group: "Settings",
    blurb: "Upgrade, switch payment method, check AI usage against your plan.",
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
