import Link from "next/link";
import {
  ArrowRightIcon,
  BuildingOffice2Icon,
  RocketLaunchIcon,
  Squares2X2Icon,
  CheckIcon,
} from "@heroicons/react/24/outline";
import MarketingShell from "@/components/marketing/MarketingShell";
import Reveal from "@/components/marketing/Reveal";

export const metadata = {
  title: "Solutions — HireOps AI",
  description:
    "HireOps for in-house recruiting teams, agencies running multiple clients, and enterprise hiring at scale.",
};

interface Solution {
  icon: React.ReactNode;
  audience: string;
  headline: string;
  problem: string;
  outcome: string;
  bullets: string[];
}

const SOLUTIONS: Solution[] = [
  {
    icon: <RocketLaunchIcon className="w-7 h-7" />,
    audience: "Startups & scale-ups",
    headline: "Hire your next 10 engineers without a full-time recruiter",
    problem:
      "You're running interviews on top of your day job. Resumes pile up in shared inboxes. The good people drift while you triage.",
    outcome:
      "HireOps clears the inbox, scores every resume, runs first-round AI interviews, and surfaces only the candidates worth your team's calendar time.",
    bullets: [
      "Free up to 25 candidates / 5 jobs — perfect for a Series A burst",
      "First AI screen in minutes, not days",
      "No need to hire a recruiter to scale hiring",
    ],
  },
  {
    icon: <Squares2X2Icon className="w-7 h-7" />,
    audience: "Recruiting agencies",
    headline: "Run more clients per recruiter with AI-augmented screening",
    problem:
      "Each new client means more inboxes to watch, more JDs to remember, more candidates to evaluate. You're capped by recruiter throughput, not pipeline.",
    outcome:
      "Multi-tenant by default — every client gets isolated data and branded interview emails. AI does the first pass; your recruiters spend time on the placements that close.",
    bullets: [
      "Tenant isolation per client, no data leakage",
      "Branded candidate emails per client account",
      "Audit logs on every superadmin action — proof for SOC 2",
    ],
  },
  {
    icon: <BuildingOffice2Icon className="w-7 h-7" />,
    audience: "Enterprise people teams",
    headline: "Standardise interviews across the org, with auditability",
    problem:
      "Every hiring manager runs interviews differently. Decisions are inconsistent. Compliance teams want an audit trail you don't have.",
    outcome:
      "HireOps standardises the early-funnel: same scoring rubric, same interview agent, same fraud signals. Every decision is logged with the evidence the AI saw.",
    bullets: [
      "Consistent rubric across teams (Mistral agent + threshold tuning)",
      "Every advance/hold/reject decision logged",
      "GDPR-ready: per-tenant data export and hard-delete",
    ],
  },
];

export default function SolutionsPage() {
  return (
    <MarketingShell>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-blue-50 via-white to-blue-50">
        <div className="bg-blobs absolute inset-0 overflow-hidden pointer-events-none">
          <div className="blob-extra" />
        </div>
        <div className="relative max-w-5xl mx-auto px-6 pt-16 pb-20 lg:pt-24 lg:pb-28 text-center">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold tracking-widest uppercase text-blue-700 bg-white/60 ring-1 ring-blue-200 backdrop-blur-sm">
            Solutions
          </span>
          <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-slate-900 leading-[1.05]">
            Built for the way{" "}
            <span className="bg-gradient-to-br from-blue-500 via-blue-600 to-blue-800 bg-clip-text text-transparent animate-gradient-sweep">
              you hire
            </span>
          </h1>
          <p className="mt-6 max-w-2xl mx-auto text-lg text-slate-600">
            Whether you're a four-person startup or a 200-recruiter agency, HireOps adapts to
            how your team works — not the other way around.
          </p>
        </div>
      </section>

      {/* Solution blocks */}
      <section className="py-16 lg:py-24 bg-white">
        <div className="max-w-6xl mx-auto px-6 space-y-12">
          {SOLUTIONS.map((s, i) => (
            <Reveal key={s.audience} delay={i * 100} as="article"
              className={`rounded-3xl p-8 lg:p-12 ${
                i === 1
                  ? "bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-2xl shadow-blue-900/20"
                  : i === 2
                  ? "bg-slate-900 text-white"
                  : "bg-white border border-slate-200"
              }`}
            >
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 lg:gap-14">
                <div className="lg:col-span-1">
                  <div
                    className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-5 ${
                      i === 0
                        ? "bg-blue-100 text-blue-700"
                        : "bg-white/15 text-white"
                    }`}
                  >
                    {s.icon}
                  </div>
                  <span
                    className={`text-[11px] font-bold tracking-widest uppercase ${
                      i === 0 ? "text-blue-600" : "text-white/70"
                    }`}
                  >
                    {s.audience}
                  </span>
                  <h2 className={`mt-2 text-2xl lg:text-3xl font-bold tracking-tight leading-tight ${i === 0 ? "text-slate-900" : "text-white"}`}>
                    {s.headline}
                  </h2>
                </div>
                <div className="lg:col-span-2 space-y-5">
                  <div>
                    <p
                      className={`text-[11px] font-bold tracking-widest uppercase mb-2 ${
                        i === 0 ? "text-slate-400" : "text-white/60"
                      }`}
                    >
                      The problem
                    </p>
                    <p className={`text-base leading-relaxed ${i === 0 ? "text-slate-600" : "text-white/90"}`}>
                      {s.problem}
                    </p>
                  </div>
                  <div>
                    <p
                      className={`text-[11px] font-bold tracking-widest uppercase mb-2 ${
                        i === 0 ? "text-blue-600" : "text-white/80"
                      }`}
                    >
                      What HireOps does
                    </p>
                    <p className={`text-base leading-relaxed ${i === 0 ? "text-slate-700" : "text-white"}`}>
                      {s.outcome}
                    </p>
                  </div>
                  <ul className="grid grid-cols-1 sm:grid-cols-1 gap-2 pt-2">
                    {s.bullets.map((b) => (
                      <li
                        key={b}
                        className={`flex items-start gap-3 text-sm ${i === 0 ? "text-slate-700" : "text-white/95"}`}
                      >
                        <span
                          className={`mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full shrink-0 ${
                            i === 0 ? "bg-blue-100 text-blue-700" : "bg-white/20 text-white"
                          }`}
                        >
                          <CheckIcon className="w-3.5 h-3.5" />
                        </span>
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-20 overflow-hidden bg-gradient-to-br from-blue-600 via-blue-700 to-slate-900">
        <div className="bg-blobs absolute inset-0 overflow-hidden opacity-30 pointer-events-none">
          <div className="blob-extra" />
        </div>
        <div className="relative max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            Not sure which fit is yours?
          </h2>
          <p className="mt-4 text-lg text-blue-100">
            Tell us about your team — we&apos;ll show you the shortest path.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-full bg-white text-blue-700 font-semibold hover:bg-blue-50 transition-all shadow-xl shadow-blue-900/20"
            >
              Start free trial
              <ArrowRightIcon className="w-4 h-4" />
            </Link>
            <Link
              href="https://symprio.com/contact" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center justify-center px-8 py-3.5 rounded-full bg-white/10 text-white font-semibold ring-1 ring-white/30 hover:bg-white/20 transition-all backdrop-blur-sm"
            >
              Talk to sales
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
