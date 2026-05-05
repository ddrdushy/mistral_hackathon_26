import Link from "next/link";
import Image from "next/image";
import {
  ArrowRightIcon,
  EnvelopeIcon,
  SparklesIcon,
  PhoneIcon,
  ShieldCheckIcon,
  ChartBarIcon,
  BriefcaseIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";
import MarketingShell from "@/components/marketing/MarketingShell";

export const metadata = {
  title: "Features — HireOps AI",
  description:
    "Email auto-classification, AI resume scoring, Q&A and voice interviews, anti-fraud signals, and a decision dashboard — every part of your hiring funnel covered.",
};

interface Feature {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
}

const FEATURES: Feature[] = [
  {
    icon: <EnvelopeIcon className="w-6 h-6" />,
    eyebrow: "Auto-intake",
    title: "Inbound applications, parsed and ranked the moment they arrive",
    body:
      "Connect your Gmail and HireOps watches the inbox. Every application email is detected, classified, deduped, and turned into a candidate record with the resume already attached — no manual triage, no missed inboxes.",
    bullets: [
      "Gmail OAuth — no shared password",
      "Mistral classifier separates real applications from spam",
      "Resume parsed (PDF / DOCX) and matched to the right job",
      "Duplicate detection so the same candidate isn't created twice",
    ],
  },
  {
    icon: <SparklesIcon className="w-6 h-6" />,
    eyebrow: "AI resume scoring",
    title: "Every resume scored 0–100 against the job, with evidence",
    body:
      "A Mistral agent reads each resume against the job description and returns a score, the evidence behind it, the skill gaps it found, and a recommended next action — advance, hold, or reject.",
    bullets: [
      "Score with explainable evidence (no black box)",
      "Skill gaps surfaced so you know what's missing",
      "Recommended action per candidate",
      "Threshold-based auto-decisions tuned per job",
    ],
  },
  {
    icon: <PhoneIcon className="w-6 h-6" />,
    eyebrow: "Q&A or voice interviews",
    title: "Pick written multi-round Q&A or live ElevenLabs voice screens",
    body:
      "Each candidate gets a personalised set of questions generated for the role. Run async written rounds (great for global hiring) or live AI voice interviews in their browser. Every transcript is captured and scored.",
    bullets: [
      "Multi-round Q&A with branching follow-ups",
      "ElevenLabs realtime voice agent — no install",
      "Per-candidate unique question set (no answer-sharing)",
      "Auto-evaluated transcripts with strength/concern signals",
    ],
  },
  {
    icon: <ShieldCheckIcon className="w-6 h-6" />,
    eyebrow: "Anti-fraud signals",
    title: "Catch impersonation, copy-paste, and tab-switching live",
    body:
      "We flag the integrity issues a phone screen would never see: who's actually in front of the camera, when they switched tabs, when they pasted text. Every signal is attached to the candidate before you decide.",
    bullets: [
      "Webcam face tracking with confidence score",
      "Tab-switch detection during interviews",
      "Paste alerts on free-text answers",
      "Composite fraud risk score per candidate",
    ],
  },
  {
    icon: <ChartBarIcon className="w-6 h-6" />,
    eyebrow: "Decision dashboard",
    title: "The whole pipeline at a glance, ranked the way you'd rank it",
    body:
      "Live KPIs, score distribution, decision donut, top-candidate leaderboard, and a 'needs HR action' queue. Stop reading résumés one-by-one — the dashboard surfaces the people worth your time.",
    bullets: [
      "Real-time pipeline funnel with stage conversion",
      "Top candidates leaderboard tuned per job",
      "Decision donut: advance / hold / reject mix",
      "'Needs HR action' queue — only what humans should touch",
    ],
  },
  {
    icon: <BriefcaseIcon className="w-6 h-6" />,
    eyebrow: "Hiring workflow",
    title: "From scheduling to email to .ics — the boring parts, automated",
    body:
      "HireOps handles the operational glue: branded interview invitations, calendar invites your candidates can accept in one click, CSV exports, GDPR data exports, and the audit trail to prove every decision was made fairly.",
    bullets: [
      "Branded interview emails with one-click links",
      "Calendar invites (.ics) auto-attached",
      "CSV + GDPR export per tenant",
      "Audit log of every superadmin action",
    ],
  },
];

export default function FeaturesPage() {
  return (
    <MarketingShell>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-blue-50 via-white to-blue-50">
        <div className="bg-blobs absolute inset-0 overflow-hidden pointer-events-none">
          <div className="blob-extra" />
        </div>
        <div className="relative max-w-5xl mx-auto px-6 pt-16 pb-20 lg:pt-24 lg:pb-28 text-center">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold tracking-widest uppercase text-blue-700 bg-white/60 ring-1 ring-blue-200 backdrop-blur-sm">
            Features
          </span>
          <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-slate-900 leading-[1.05]">
            Every part of the funnel,{" "}
            <span className="bg-gradient-to-br from-blue-500 to-blue-700 bg-clip-text text-transparent">
              covered
            </span>
          </h1>
          <p className="mt-6 max-w-2xl mx-auto text-lg text-slate-600">
            From inbox to hired, HireOps does the boring parts so your team can focus on the
            humans actually worth talking to.
          </p>
        </div>
      </section>

      {/* Feature blocks */}
      <section className="py-16 lg:py-24 bg-white">
        <div className="max-w-6xl mx-auto px-6 space-y-20 lg:space-y-28">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className={`grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center ${
                i % 2 === 1 ? "lg:[&>*:first-child]:order-2" : ""
              }`}
            >
              <div>
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-blue-100 text-blue-700 mb-5">
                  {f.icon}
                </div>
                <span className="text-[11px] font-bold tracking-widest text-blue-600 uppercase">
                  {f.eyebrow}
                </span>
                <h2 className="mt-2 text-3xl lg:text-4xl font-bold tracking-tight text-slate-900 leading-tight">
                  {f.title}
                </h2>
                <p className="mt-5 text-lg text-slate-600 leading-relaxed">{f.body}</p>
                <ul className="mt-7 space-y-3">
                  {f.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-3 text-slate-700">
                      <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 shrink-0">
                        <CheckIcon className="w-3.5 h-3.5" />
                      </span>
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-3xl bg-gradient-to-br from-blue-50 to-white border border-blue-100 p-8 lg:p-10 aspect-[4/3] flex items-center justify-center relative overflow-hidden">
                <div className="bg-blobs absolute inset-0 overflow-hidden pointer-events-none opacity-50">
                  <div className="blob-extra" />
                </div>
                {/* Use whichever asset fits the feature */}
                {f.eyebrow === "Auto-intake" && (
                  <Image src="/landing/pillar-1.webp" alt="" width={280} height={280} className="relative" />
                )}
                {f.eyebrow === "Decision dashboard" && (
                  <Image src="/landing/pillar-2.webp" alt="" width={280} height={280} className="relative" />
                )}
                {f.eyebrow === "AI resume scoring" && (
                  <Image src="/landing/hero-illustration.webp" alt="" width={420} height={260} className="relative object-contain" />
                )}
                {(f.eyebrow !== "Auto-intake" && f.eyebrow !== "Decision dashboard" && f.eyebrow !== "AI resume scoring") && (
                  <div className="text-9xl font-bold text-blue-200/60 select-none">{String(i + 1).padStart(2, "0")}</div>
                )}
              </div>
            </div>
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
            See it on your own inbox
          </h2>
          <p className="mt-4 text-lg text-blue-100">
            Sign up free, connect Gmail, watch HireOps process the next application within
            seconds.
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
              href="/contact"
              className="inline-flex items-center justify-center px-8 py-3.5 rounded-full bg-white/10 text-white font-semibold ring-1 ring-white/30 hover:bg-white/20 transition-all backdrop-blur-sm"
            >
              Book a demo
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
