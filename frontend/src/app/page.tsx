import Link from "next/link";
import {
  BriefcaseIcon,
  EnvelopeIcon,
  SparklesIcon,
  ShieldCheckIcon,
  ChartBarIcon,
  PhoneIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";

export const metadata = {
  title: "HireOps AI — From inbox to hired, on autopilot",
  description:
    "Multi-tenant AI recruiting OS. Auto-classify applications, score resumes, run AI Q&A and voice interviews, and surface the best candidates — all from a single dashboard.",
};

export default function LandingPage() {
  return (
    <div className="bg-white">
      <NavBar />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-50 via-white to-violet-50 -z-10" />
        <div className="max-w-6xl mx-auto px-6 pt-20 pb-24 lg:pt-28 lg:pb-32">
          <div className="text-center max-w-3xl mx-auto">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200 mb-6">
              <SparklesIcon className="w-3.5 h-3.5" />
              Powered by Mistral AI
            </span>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 tracking-tight leading-[1.05]">
              From inbox to hired,{" "}
              <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
                on autopilot
              </span>
            </h1>
            <p className="mt-6 text-lg text-slate-600 leading-relaxed max-w-2xl mx-auto">
              The AI recruiting OS that auto-classifies applications, scores resumes, runs Q&amp;A or voice interviews, and surfaces the best candidates — all from a single dashboard.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center px-6 py-3 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
              >
                Start free
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center px-6 py-3 rounded-lg bg-white text-slate-900 font-semibold border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Sign in
              </Link>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Free forever for up to 25 candidates. No card required.
            </p>
          </div>

          {/* Mockup card */}
          <div className="mt-16 max-w-4xl mx-auto">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl shadow-indigo-900/10 overflow-hidden">
              <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-200 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <span className="ml-3 text-xs text-slate-400 font-mono">hireops.symprio.com/dashboard</span>
              </div>
              <div className="p-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <KpiTile label="Applications" value="284" trend="+18%" />
                <KpiTile label="Avg score" value="74" trend="+4" />
                <KpiTile label="Shortlisted" value="23" trend="8% conv." />
              </div>
              <div className="px-6 pb-6">
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
                    Pipeline
                  </p>
                  <div className="space-y-2">
                    {[
                      { l: "New", v: 42, c: "bg-blue-500" },
                      { l: "Matched", v: 105, c: "bg-indigo-500" },
                      { l: "Screened", v: 78, c: "bg-amber-500" },
                      { l: "Shortlisted", v: 23, c: "bg-emerald-500" },
                      { l: "Rejected", v: 36, c: "bg-red-400" },
                    ].map((r) => (
                      <div key={r.l} className="flex items-center gap-3">
                        <span className="text-xs text-slate-600 w-20 truncate">{r.l}</span>
                        <div className="flex-1 h-2 rounded-full bg-slate-200 overflow-hidden">
                          <div
                            className={`h-full ${r.c}`}
                            style={{ width: `${(r.v / 105) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-slate-700 tabular-nums w-8 text-right">
                          {r.v}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────── */}
      <section id="features" className="py-20 lg:py-24 bg-slate-50">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">
              How it works
            </span>
            <h2 className="mt-2 text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
              The full hiring loop, automated
            </h2>
            <p className="mt-4 text-slate-600">
              Connect your Gmail. Watch HireOps process applications end-to-end while you focus on the candidates who actually matter.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            <FeatureCard
              icon={<EnvelopeIcon className="w-5 h-5" />}
              title="Email auto-classification"
              body="Inbound applications are auto-detected, parsed, and converted into candidate records — no manual intake."
            />
            <FeatureCard
              icon={<SparklesIcon className="w-5 h-5" />}
              title="AI resume scoring"
              body="Every resume is scored 0–100 against the job, with evidence, gaps, and a suggested next action."
            />
            <FeatureCard
              icon={<PhoneIcon className="w-5 h-5" />}
              title="Q&A or voice interviews"
              body="Pick written multi-round Q&A or live voice interviews with our AI agent. Each candidate gets unique questions."
            />
            <FeatureCard
              icon={<ShieldCheckIcon className="w-5 h-5" />}
              title="Anti-fraud signals"
              body="Webcam face tracking, tab-switch detection, and paste alerts surface integrity issues before you decide."
            />
            <FeatureCard
              icon={<ChartBarIcon className="w-5 h-5" />}
              title="Decision dashboard"
              body="Score gauges, fraud risk, pipeline funnel, and a 'Needs HR action' queue — at a glance."
            />
            <FeatureCard
              icon={<BriefcaseIcon className="w-5 h-5" />}
              title="Threshold-based decisions"
              body="Auto-advance, auto-reject, or hold — tuned per job. HR only sees the cases that actually need a human."
            />
          </div>
        </div>
      </section>

      {/* ── Pricing teaser ──────────────────────────────────────────── */}
      <section className="py-20 lg:py-24">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">
              Pricing
            </span>
            <h2 className="mt-2 text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
              Simple, fair pricing
            </h2>
            <p className="mt-4 text-slate-600">
              Start free. Upgrade only when you outgrow the free tier.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <PricingCard
              name="Free"
              price="$0"
              cadence="forever"
              cta="Start free"
              ctaHref="/signup"
              features={[
                "5 active jobs",
                "25 candidates",
                "10 interviews / month",
                "Q&A + voice modes",
                "AI fraud detection",
              ]}
            />
            <PricingCard
              name="Starter"
              price="Coming soon"
              cadence=""
              cta="Get notified"
              ctaHref="/signup"
              features={[
                "25 active jobs",
                "250 candidates",
                "100 interviews / month",
                "Branded interview emails",
                "Priority support",
              ]}
              highlighted
            />
            <PricingCard
              name="Pro"
              price="Coming soon"
              cadence=""
              cta="Talk to us"
              ctaHref="/signup"
              features={[
                "Unlimited jobs",
                "Unlimited candidates",
                "Unlimited interviews",
                "Team seats",
                "SSO + audit logs",
              ]}
            />
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────── */}
      <section className="py-16 bg-gradient-to-br from-indigo-600 to-violet-700">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            Stop reading resumes. Start hiring.
          </h2>
          <p className="mt-4 text-indigo-100">
            Set up your workspace in 60 seconds. Your inbox does the rest.
          </p>
          <Link
            href="/signup"
            className="mt-7 inline-flex items-center justify-center px-6 py-3 rounded-lg bg-white text-indigo-700 font-semibold hover:bg-indigo-50 transition-colors shadow-sm"
          >
            Create your workspace
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────

function NavBar() {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-white/80 border-b border-slate-200">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="inline-flex items-center gap-2.5">
          <span className="flex items-center justify-center w-8 h-8 bg-indigo-600 rounded-lg">
            <BriefcaseIcon className="w-5 h-5 text-white" />
          </span>
          <span className="font-semibold text-slate-900 tracking-tight">HireOps AI</span>
        </Link>
        <nav className="hidden md:flex items-center gap-7 text-sm text-slate-600">
          <a href="#features" className="hover:text-slate-900">Features</a>
          <a href="#pricing" className="hover:text-slate-900">Pricing</a>
          <Link href="/login" className="hover:text-slate-900">Sign in</Link>
        </nav>
        <Link
          href="/signup"
          className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
        >
          Start free
        </Link>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-slate-200 py-10">
      <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-7 h-7 bg-indigo-600 rounded-md">
            <BriefcaseIcon className="w-4 h-4 text-white" />
          </span>
          <span className="text-sm text-slate-600">HireOps AI · A Symprio product</span>
        </div>
        <div className="flex items-center gap-5 text-sm text-slate-500">
          <Link href="/legal/privacy" className="hover:text-slate-700">Privacy</Link>
          <Link href="/legal/terms" className="hover:text-slate-700">Terms</Link>
          <span className="text-xs text-slate-400">© {new Date().getFullYear()}</span>
        </div>
      </div>
    </footer>
  );
}

function KpiTile({ label, value, trend }: { label: string; value: string; trend: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
      <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
      <p className="text-xs text-emerald-600 font-medium mt-1">{trend}</p>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 hover:border-indigo-300 hover:shadow-md transition-all">
      <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center mb-3">
        {icon}
      </div>
      <h3 className="font-semibold text-slate-900 mb-1">{title}</h3>
      <p className="text-sm text-slate-600 leading-relaxed">{body}</p>
    </div>
  );
}

function PricingCard({
  name,
  price,
  cadence,
  cta,
  ctaHref,
  features,
  highlighted,
}: {
  name: string;
  price: string;
  cadence: string;
  cta: string;
  ctaHref: string;
  features: string[];
  highlighted?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-6 ${
        highlighted
          ? "bg-slate-900 text-white shadow-2xl shadow-indigo-900/10 scale-[1.02]"
          : "bg-white border border-slate-200"
      }`}
    >
      <p className={`text-sm font-semibold ${highlighted ? "text-indigo-300" : "text-slate-500"}`}>
        {name}
      </p>
      <p className="mt-2 flex items-baseline gap-2">
        <span className={`text-3xl font-bold ${highlighted ? "text-white" : "text-slate-900"}`}>
          {price}
        </span>
        {cadence && (
          <span className={`text-sm ${highlighted ? "text-indigo-200" : "text-slate-500"}`}>
            {cadence}
          </span>
        )}
      </p>
      <ul className="mt-5 space-y-2">
        {features.map((f) => (
          <li key={f} className={`flex items-center gap-2 text-sm ${highlighted ? "text-indigo-100" : "text-slate-600"}`}>
            <CheckIcon className="w-4 h-4 text-emerald-500 shrink-0" />
            {f}
          </li>
        ))}
      </ul>
      <Link
        href={ctaHref}
        className={`mt-6 w-full inline-flex items-center justify-center px-4 py-2.5 rounded-lg font-semibold text-sm transition-colors ${
          highlighted
            ? "bg-white text-slate-900 hover:bg-slate-100"
            : "bg-indigo-600 text-white hover:bg-indigo-700"
        }`}
      >
        {cta}
      </Link>
    </div>
  );
}
