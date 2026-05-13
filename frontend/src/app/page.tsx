import Link from "next/link";
import Image from "next/image";
import {
  ArrowRightIcon,
  CheckIcon,
  SparklesIcon,
  ShieldCheckIcon,
  ChartBarIcon,
  PhoneIcon,
  EnvelopeIcon,
  BriefcaseIcon,
} from "@heroicons/react/24/outline";
import MarketingShell from "@/components/marketing/MarketingShell";
import Reveal from "@/components/marketing/Reveal";

export const metadata = {
  title: "HireOps AI — From inbox to hired, on autopilot",
  description:
    "The AI recruiting OS that auto-classifies applications, scores resumes, runs Q&A or voice interviews, and surfaces the best candidates — all from a single dashboard.",
};

// ISR: re-fetch testimonials every 60s so admin edits propagate without a redeploy.
export const revalidate = 60;

interface ApiTestimonial {
  id: number;
  quote: string;
  author_name: string;
  author_role: string;
  avatar_url: string;
  display_order: number;
}

const FALLBACK_TESTIMONIALS: ApiTestimonial[] = [
  { id: 1, quote: "We used to spend Mondays clearing the inbox. HireOps did it before our coffee was cold.", author_name: "Priya Anand", author_role: "Head of Talent", avatar_url: "/landing/avatar-asian-woman.webp", display_order: 1 },
  { id: 2, quote: "The voice interview catches things a phone screen never would. Fraud signals are gold.", author_name: "Marcus Thompson", author_role: "Recruiting Lead", avatar_url: "/landing/avatar-black-man.webp", display_order: 2 },
  { id: 3, quote: "Set thresholds once, watch the queue self-organize. We hired three engineers in two weeks.", author_name: "James Reeves", author_role: "VP People", avatar_url: "/landing/avatar-man-40s.webp", display_order: 3 },
  { id: 4, quote: "It actually feels like a teammate. The shortlist it surfaces is the shortlist I'd build.", author_name: "Sara Mitchell", author_role: "Senior Recruiter", avatar_url: "/landing/avatar-woman-30s.webp", display_order: 4 },
];

async function fetchTestimonials(): Promise<ApiTestimonial[]> {
  const base = process.env.NEXT_PUBLIC_API_URL || "https://hireops.symprio.com/api/v1";
  try {
    const res = await fetch(`${base}/testimonials`, { next: { revalidate: 60 } });
    if (!res.ok) return FALLBACK_TESTIMONIALS;
    const data = (await res.json()) as { testimonials: ApiTestimonial[] };
    return data.testimonials.length > 0 ? data.testimonials : FALLBACK_TESTIMONIALS;
  } catch {
    return FALLBACK_TESTIMONIALS;
  }
}

export default async function LandingPage() {
  const testimonials = await fetchTestimonials();
  return (
    <MarketingShell>
      {/* ──────────────────────────────────────────────────────────────
         HERO — dramatic radial glow, framed illustration, feature pills
         ────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-blue-50 via-white to-indigo-50/40">
        {/* Layered backdrop:
           - top-right radial spotlight that casts the warm glow behind the illo
           - bottom-left ambient glow for depth
           - faint dot grid texture pinned to the whole section */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 pointer-events-none"
          style={{
            background:
              "radial-gradient(60% 50% at 80% 20%, rgba(59,130,246,0.18), transparent 70%), radial-gradient(40% 35% at 10% 90%, rgba(99,102,241,0.14), transparent 75%)",
          }}
        />
        <div className="bg-dot-grid absolute inset-0 -z-10 opacity-50" />

        <div className="relative max-w-7xl mx-auto px-6 pt-20 pb-24 lg:pt-28 lg:pb-32 grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-14 items-center">
          {/* Left column */}
          <div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold tracking-widest uppercase text-blue-700 bg-white/70 ring-1 ring-blue-200 backdrop-blur-sm shadow-sm shadow-blue-100">
              <SparklesIcon className="w-3.5 h-3.5" />
              Powered by Mistral &amp; ElevenLabs
            </span>

            <h1 className="mt-6 text-5xl sm:text-6xl lg:text-[5.25rem] font-bold tracking-tight text-slate-900 leading-[1.02]">
              From inbox to{" "}
              <span className="relative inline-block">
                <span className="bg-gradient-to-br from-blue-500 via-indigo-600 to-violet-700 bg-clip-text text-transparent animate-gradient-sweep">
                  hired
                </span>
                {/* Underline accent */}
                <svg
                  aria-hidden
                  viewBox="0 0 220 12"
                  className="absolute left-0 -bottom-2 w-full h-2 text-blue-400/70"
                  preserveAspectRatio="none"
                >
                  <path
                    d="M2 8 C 60 2, 140 2, 218 8"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    fill="none"
                  />
                </svg>
              </span>
              ,<br className="hidden sm:block" /> on autopilot
            </h1>

            <p className="mt-7 max-w-xl text-lg text-slate-600 leading-relaxed">
              The AI recruiting OS that auto-classifies applications, scores resumes,
              runs Q&amp;A or voice interviews, and surfaces the best candidates —
              from a single dashboard.
            </p>

            <div className="mt-9 flex flex-col sm:flex-row gap-3">
              <Link
                href="/signup"
                className="group inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-white font-semibold shadow-lg shadow-blue-600/30 hover:shadow-xl hover:shadow-blue-600/40 hover:-translate-y-0.5 transition-all"
              >
                Start free trial
                <ArrowRightIcon className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="https://symprio.com/contact"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-7 py-3.5 rounded-full bg-white text-slate-900 font-semibold border border-slate-200 hover:border-slate-300 hover:shadow-sm transition-all"
              >
                Book a demo
              </Link>
            </div>

            <p className="mt-4 text-xs text-slate-500">
              Free trial · No credit card required · 25 candidates included
            </p>

            {/* Feature trust pills (replace live numeric stats so a fresh
                tenant's low counts don't undermine credibility) */}
            <ul className="mt-10 flex flex-wrap gap-2 max-w-xl">
              {[
                { label: "Sub-4s resume scoring", icon: <SparklesIcon className="w-3.5 h-3.5" /> },
                { label: "Voice + Q&A interviews", icon: <PhoneIcon className="w-3.5 h-3.5" /> },
                { label: "Fraud detection built-in", icon: <ShieldCheckIcon className="w-3.5 h-3.5" /> },
                { label: "Multi-tenant + GDPR ready", icon: <CheckIcon className="w-3.5 h-3.5" /> },
              ].map((f) => (
                <li
                  key={f.label}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/70 ring-1 ring-slate-200 text-xs font-medium text-slate-700 backdrop-blur-sm"
                >
                  <span className="text-blue-600">{f.icon}</span>
                  {f.label}
                </li>
              ))}
            </ul>
          </div>

          {/* Right column — illustration wrapped in a glassmorphic frame
              so the artwork's baked-in alpha checker doesn't bleed
              against the page background. Floating decorative chips
              + soft glow add depth without needing more art. */}
          <div className="relative">
            {/* Outer ambient glow */}
            <div
              aria-hidden
              className="absolute inset-0 -m-12 rounded-[3rem] bg-[radial-gradient(closest-side,rgba(99,102,241,0.25),transparent_70%)] blur-2xl"
            />

            <div className="relative animate-float">
              {/* Glass card frame */}
              <div className="relative rounded-[2rem] bg-gradient-to-br from-white/80 via-white/40 to-blue-100/60 backdrop-blur-md ring-1 ring-white/60 shadow-2xl shadow-blue-900/10 p-2 sm:p-3">
                <div className="relative aspect-[5/4] w-full overflow-hidden rounded-[1.5rem] bg-gradient-to-br from-slate-50 via-white to-blue-50">
                  <Image
                    src="/landing/hero-illustration.webp"
                    alt="Resume stack flowing into a glowing AI orb that produces approved candidate cards"
                    fill
                    priority
                    sizes="(max-width:1024px) 100vw, 50vw"
                    className="object-contain p-2"
                  />
                  {/* Soft inner highlight */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-white/0 to-white/30"
                  />
                </div>
              </div>

              {/* Floating chip — top-left */}
              <div className="hidden sm:flex absolute -top-4 -left-5 items-center gap-2 px-3 py-2 rounded-xl bg-white shadow-xl shadow-blue-900/10 ring-1 ring-slate-200 animate-float-slow">
                <span className="inline-flex w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 items-center justify-center">
                  <CheckIcon className="w-4 h-4" />
                </span>
                <div className="leading-tight">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    Auto-scored
                  </p>
                  <p className="text-xs font-bold text-slate-900">+12 candidates</p>
                </div>
              </div>

              {/* Floating chip — bottom-right */}
              <div className="hidden sm:flex absolute -bottom-5 -right-4 items-center gap-2 px-3 py-2 rounded-xl bg-white shadow-xl shadow-indigo-900/10 ring-1 ring-slate-200 animate-float-delayed">
                <span className="inline-flex w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 items-center justify-center">
                  <PhoneIcon className="w-4 h-4" />
                </span>
                <div className="leading-tight">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    Voice screen
                  </p>
                  <p className="text-xs font-bold text-slate-900">Live · 2m 14s</p>
                </div>
              </div>

              {/* Floating chip — middle-right */}
              <div className="hidden lg:flex absolute top-1/3 -right-8 items-center gap-2 px-3 py-2 rounded-xl bg-slate-900 text-white shadow-2xl shadow-slate-900/20 animate-float">
                <span className="inline-flex w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <div className="leading-tight">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    Score
                  </p>
                  <p className="text-sm font-bold tabular-nums">87 / 100</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────
         POWERED BY — Mistral + ElevenLabs partner strip
         TODO: when official SVG logos are available, drop them in
         /public/landing/ and replace the inline wordmarks below.
         ────────────────────────────────────────────────────────────── */}
      <section className="py-12 lg:py-16 bg-white border-y border-slate-100">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <p className="text-[11px] font-bold tracking-widest text-slate-400 uppercase mb-7">
            Powered by
          </p>
          <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-12">
            {/* Mistral AI wordmark — orange triangular accent + brand text */}
            <a
              href="https://mistral.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-3 px-6 py-4 rounded-2xl bg-white border border-slate-200 hover:border-orange-300 hover:shadow-md transition-all"
            >
              <span className="relative inline-block w-7 h-7">
                <svg viewBox="0 0 32 32" className="w-full h-full">
                  <path d="M4 4h6v6H4zM10 10h6v6h-6zM16 4h6v6h-6zM4 16h6v6H4zM16 16h6v6h-6zM22 22h6v6h-6zM4 22h6v6H4zM22 4h6v6h-6z" fill="#FA520F" />
                </svg>
              </span>
              <span className="text-2xl font-bold tracking-tight text-slate-900">Mistral AI</span>
            </a>

            {/* ElevenLabs wordmark — stacked-bars accent + brand text */}
            <a
              href="https://elevenlabs.io"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-3 px-6 py-4 rounded-2xl bg-white border border-slate-200 hover:border-slate-400 hover:shadow-md transition-all"
            >
              <span className="relative inline-block w-7 h-7">
                <svg viewBox="0 0 32 32" className="w-full h-full">
                  <rect x="9" y="6" width="4" height="20" rx="1" fill="#0F172A" />
                  <rect x="19" y="6" width="4" height="20" rx="1" fill="#0F172A" />
                </svg>
              </span>
              <span className="text-2xl font-bold tracking-tight text-slate-900">ElevenLabs</span>
            </a>
          </div>
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────
         THREE PILLARS — white / blue / dark, ANN-inspired big cards
         ────────────────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-20 lg:py-28 relative">
        <div className="absolute inset-0 bg-dot-grid opacity-60 -z-10" />
        <div className="max-w-7xl mx-auto px-6">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-16">
              <span className="text-[11px] font-bold tracking-widest text-blue-600 uppercase">
                How it works
              </span>
              <h2 className="mt-3 text-4xl sm:text-5xl font-bold tracking-tight text-slate-900">
                The full hiring loop, automated
              </h2>
              <p className="mt-5 text-slate-600 text-lg">
                Three big jobs HireOps does so your team can stop reading resumes and start
                talking to humans.
              </p>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Reveal delay={0}>
              <PillarCard
                variant="white"
                eyebrow="Step 01"
                title={<>Automated<br />intake</>}
                body="Every inbound application is parsed, deduped, and converted into a candidate record — no manual triage, no missed inboxes."
                imageSrc="/landing/pillar-1.webp"
                imageAlt="Paper airplane lifting off from an inbox tray"
                href="/signup"
                cta="Try it free"
              />
            </Reveal>
            <Reveal delay={120}>
              <PillarCard
                variant="blue"
                eyebrow="Step 02"
                title={<>AI evaluation<br />at scale</>}
                body="Resumes scored 0–100 with evidence and gaps. Run AI Q&A interviews or live ElevenLabs voice screens — each candidate gets unique questions."
                href="/signup"
                cta="See the agents"
              />
            </Reveal>
            <Reveal delay={240}>
              <PillarCard
                variant="dark"
                eyebrow="Step 03"
                title={<>Decisions on<br />autopilot</>}
                body="Threshold-based auto-advance, hold, or reject — tuned per job. HR only sees the cases that need a human. Every decision is logged."
                imageSrc="/landing/pillar-2.webp"
                imageAlt="Magnifying glass over a rising bar chart"
                href="/signup"
                cta="Open dashboard"
              />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────
         FEATURE GRID — the 6 specifics, smaller cards
         ────────────────────────────────────────────────────────────── */}
      <section className="py-20 lg:py-24 bg-slate-50">
        <div className="max-w-6xl mx-auto px-6">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-12">
              <span className="text-[11px] font-bold tracking-widest text-blue-600 uppercase">
                Capabilities
              </span>
              <h2 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
                Every part of the funnel, covered
              </h2>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                icon: <EnvelopeIcon className="w-5 h-5" />,
                title: "Email auto-classification",
                body: "Inbound applications detected, parsed, and turned into candidate records — no manual intake.",
                imageSrc: "/landing/feature-intake.webp",
                imageAlt: "Stylised envelope opening into a candidate profile card",
              },
              {
                icon: <SparklesIcon className="w-5 h-5" />,
                title: "Resume scoring",
                body: "Every resume scored 0–100 against the job, with evidence, gaps, and a recommended next action.",
                imageSrc: "/landing/feature-evaluation.webp",
                imageAlt: "AI scoring dial showing 78 over a stack of resumes",
              },
              {
                icon: <PhoneIcon className="w-5 h-5" />,
                title: "Q&A or voice interviews",
                body: "Pick written multi-round Q&A or live AI voice interviews. Each candidate gets unique questions.",
                imageSrc: "/landing/feature-voice.webp",
                imageAlt: "Headset hovering above a phone with a voice waveform",
              },
              {
                icon: <ShieldCheckIcon className="w-5 h-5" />,
                title: "Anti-fraud signals",
                body: "Webcam face tracking, tab-switch detection, and paste alerts surface integrity issues before you decide.",
                imageSrc: "/landing/feature-fraud.webp",
                imageAlt: "Translucent shield with a camera lens and warning marker",
              },
              {
                icon: <ChartBarIcon className="w-5 h-5" />,
                title: "Decision dashboard",
                body: "Score gauges, fraud risk, pipeline funnel, and a 'needs HR action' queue — at a glance.",
                imageSrc: "/landing/feature-dashboard.webp",
                imageAlt: "Recruiting dashboard composite with donut chart, kanban, and metrics",
              },
              {
                icon: <BriefcaseIcon className="w-5 h-5" />,
                title: "Threshold automation",
                body: "Auto-advance, auto-reject, or hold — tuned per job. HR only sees the cases that need a human.",
              },
            ].map((f, i) => (
              <Reveal key={f.title} delay={i * 80}>
                <MiniFeature
                  icon={f.icon}
                  title={f.title}
                  body={f.body}
                  imageSrc={f.imageSrc}
                  imageAlt={f.imageAlt}
                />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────
         IN-PRODUCT GLIMPSE — single big mockup composite
         ────────────────────────────────────────────────────────────── */}
      <section className="py-20 lg:py-28 bg-white relative overflow-hidden">
        <div className="absolute inset-0 bg-dot-grid opacity-50 -z-10" />
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <Reveal direction="left" className="order-2 lg:order-1 relative">
            <div className="relative aspect-square w-full max-w-lg mx-auto animate-float">
              <Image
                src="/landing/hero-mockup.webp"
                alt="HireOps dashboard composite: analytics, candidate list, pipeline funnel, and live interview"
                fill
                sizes="(max-width:1024px) 100vw, 50vw"
                className="object-contain drop-shadow-[0_25px_50px_rgba(37,99,235,0.15)]"
              />
            </div>
          </Reveal>
          <Reveal direction="right" className="order-1 lg:order-2">
            <span className="text-[11px] font-bold tracking-widest text-blue-600 uppercase">
              Inside HireOps
            </span>
            <h2 className="mt-3 text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 leading-tight">
              Your entire pipeline
              <br />
              in one workspace
            </h2>
            <p className="mt-5 text-lg text-slate-600 leading-relaxed">
              Live analytics, ranked candidate queues, automated funnel tracking, and AI
              voice interviews — every signal you need to make a hire is one click away, no
              spreadsheet gymnastics.
            </p>
            <ul className="mt-7 space-y-3">
              {[
                "Real-time score distribution + decision donut",
                "AI-recommended shortlists tuned per job",
                "Voice & Q&A transcripts with fraud signals attached",
                "Tenant-isolated data, GDPR export & hard-delete",
              ].map((s) => (
                <li key={s} className="flex items-start gap-3 text-slate-700">
                  <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 shrink-0">
                    <CheckIcon className="w-3.5 h-3.5" />
                  </span>
                  {s}
                </li>
              ))}
            </ul>
            <Link
              href="/signup"
              className="mt-8 inline-flex items-center gap-2 px-6 py-3 rounded-full bg-slate-900 text-white font-semibold hover:bg-slate-800 transition-colors"
            >
              Open the dashboard
              <ArrowRightIcon className="w-4 h-4" />
            </Link>
          </Reveal>
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────
         ROI — time saved illustration + count-up stats
         ────────────────────────────────────────────────────────────── */}
      <section className="py-20 lg:py-24 bg-white relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <Reveal direction="left">
            <span className="text-[11px] font-bold tracking-widest text-blue-600 uppercase">
              The math
            </span>
            <h2 className="mt-3 text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 leading-tight">
              Hours back in your week, every week
            </h2>
            <p className="mt-5 text-lg text-slate-600 leading-relaxed">
              A recruiter spends 6&ndash;8 minutes per resume on the first scan.
              HireOps does it in under 4 seconds, with evidence. Multiply that
              by every inbound application this month.
            </p>
            <dl className="mt-8 grid grid-cols-3 gap-6 border-t border-slate-200 pt-7">
              <div>
                <dt className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
                  Per resume
                </dt>
                <dd className="mt-1.5">
                  <span className="text-3xl font-extrabold text-slate-900 tabular-nums">100×</span>
                  <span className="block text-xs text-slate-500 mt-0.5">faster than a human pass</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
                  Shortlist
                </dt>
                <dd className="mt-1.5">
                  <span className="text-3xl font-extrabold text-slate-900 tabular-nums">8×</span>
                  <span className="block text-xs text-slate-500 mt-0.5">faster than manual review</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
                  HR hours saved
                </dt>
                <dd className="mt-1.5">
                  <span className="text-3xl font-extrabold text-slate-900 tabular-nums">~25</span>
                  <span className="block text-xs text-slate-500 mt-0.5">per 200 apps processed</span>
                </dd>
              </div>
            </dl>
            <Link
              href="/signup"
              className="mt-8 inline-flex items-center gap-2 px-6 py-3 rounded-full bg-slate-900 text-white font-semibold hover:bg-slate-800 transition-colors"
            >
              Try it free
              <ArrowRightIcon className="w-4 h-4" />
            </Link>
          </Reveal>
          <Reveal direction="right">
            <div className="relative aspect-square w-full max-w-lg mx-auto animate-float">
              <Image
                src="/landing/feature-roi.webp"
                alt="Analog clock and slow stack of paper resumes split-screen with a glowing digital timer and a single approved card"
                fill
                sizes="(max-width:1024px) 100vw, 50vw"
                className="object-contain drop-shadow-[0_25px_50px_rgba(37,99,235,0.18)]"
              />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────
         MOBILE-READY — phone mockup + copy
         ────────────────────────────────────────────────────────────── */}
      <section className="py-20 lg:py-24 bg-gradient-to-br from-slate-50 via-blue-50/60 to-slate-50">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <Reveal direction="left" className="order-2 lg:order-1">
            <div className="relative aspect-[3/5] w-full max-w-sm mx-auto animate-float">
              <Image
                src="/landing/feature-mobile.webp"
                alt="Phone screen showing a single candidate row with a score and action buttons"
                fill
                sizes="(max-width:1024px) 100vw, 33vw"
                className="object-contain drop-shadow-[0_25px_50px_rgba(15,23,42,0.15)]"
              />
            </div>
          </Reveal>
          <Reveal direction="right" className="order-1 lg:order-2">
            <span className="text-[11px] font-bold tracking-widest text-blue-600 uppercase">
              Always on
            </span>
            <h2 className="mt-3 text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 leading-tight">
              Approve a shortlist
              <br />
              from the queue
            </h2>
            <p className="mt-5 text-lg text-slate-600 leading-relaxed">
              The dashboard is fully responsive — review scored candidates,
              advance someone to the next round, or send an interview link
              right from your phone. No mobile app to install, no compromise.
            </p>
            <ul className="mt-7 space-y-3">
              {[
                "Push notification on every voice-screen completion",
                "One-tap interview invite + calendar attach",
                "WhatsApp inbound replies surface in the same inbox",
              ].map((s) => (
                <li key={s} className="flex items-start gap-3 text-slate-700">
                  <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 shrink-0">
                    <CheckIcon className="w-3.5 h-3.5" />
                  </span>
                  {s}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────
         TESTIMONIALS — 4-up grid with quote glyphs + AI avatars
         ────────────────────────────────────────────────────────────── */}
      <section className="py-20 lg:py-28 bg-blue-50/40 relative overflow-hidden">
        <div className="bg-blobs absolute inset-0 -z-10 overflow-hidden opacity-60">
          <div className="blob-extra" />
        </div>
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="text-[11px] font-bold tracking-widest text-blue-600 uppercase">
              What teams say
            </span>
            <h2 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
              Hiring leaders, lifting their week back
            </h2>
          </div>

          <div
            className={`grid grid-cols-1 sm:grid-cols-2 gap-5 ${
              testimonials.length >= 4 ? "lg:grid-cols-4" : testimonials.length === 3 ? "lg:grid-cols-3" : ""
            }`}
          >
            {testimonials.map((t, i) => (
              <Reveal key={t.id} delay={i * 100}>
                <Testimonial
                  quote={t.quote}
                  name={t.author_name}
                  role={t.author_role}
                  avatarSrc={t.avatar_url || "/landing/avatar-woman-30s.webp"}
                />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────
         PRICING TEASER
         ────────────────────────────────────────────────────────────── */}
      <section className="py-20 lg:py-24 bg-white">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-[11px] font-bold tracking-widest text-blue-600 uppercase">
              Pricing
            </span>
            <h2 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
              Simple, fair pricing
            </h2>
            <p className="mt-4 text-slate-600">
              Start with a free trial. Talk to sales when you&apos;re ready to scale —
              monthly invoicing through your Stripe account.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <Reveal delay={0}>
              <PricingCard
                name="Trial"
                price="$0"
                cadence="free"
                cta="Start trial"
                ctaHref="/signup"
                features={[
                  "5 active jobs",
                  "25 candidates",
                  "10 interviews / month",
                  "Q&A + voice modes",
                  "AI fraud detection",
                ]}
                highlighted
              />
            </Reveal>
            <Reveal delay={120}>
              <PricingCard
                name="Starter"
                price="$49"
                cadence="/ month"
                cta="Contact sales"
                ctaHref="mailto:contact@symprio.com?subject=Interested%20in%20HireOps%20Starter"
                features={[
                  "25 active jobs",
                  "250 candidates",
                  "100 interviews / month",
                  "Branded interview emails",
                  "Priority support",
                ]}
              />
            </Reveal>
            <Reveal delay={240}>
              <PricingCard
                name="Pro"
                price="$199"
                cadence="/ month"
                cta="Contact sales"
                ctaHref="mailto:contact@symprio.com?subject=Interested%20in%20HireOps%20Pro"
                features={[
                  "Unlimited jobs",
                  "Unlimited candidates",
                  "Unlimited interviews",
                  "Team seats",
                  "SSO + audit logs",
                ]}
              />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────
         FINAL CTA
         ────────────────────────────────────────────────────────────── */}
      <section className="relative py-20 lg:py-24 overflow-hidden bg-gradient-to-br from-blue-600 via-blue-700 to-slate-900">
        <div className="bg-blobs absolute inset-0 overflow-hidden opacity-30 pointer-events-none">
          <div className="blob-extra" />
        </div>

        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl sm:text-5xl font-bold text-white tracking-tight leading-tight">
            Stop reading resumes.
            <br className="hidden sm:block" /> Start hiring.
          </h2>
          <p className="mt-5 text-lg text-blue-100">
            Set up your workspace in 60 seconds. Your inbox does the rest.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center">
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
              Book a demo
            </Link>
          </div>
          <p className="mt-4 text-xs text-blue-200">
            Free forever for up to 25 candidates · No credit card required
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components

function PillarCard({
  variant,
  eyebrow,
  title,
  body,
  imageSrc,
  imageAlt,
  href,
  cta,
}: {
  variant: "white" | "blue" | "dark";
  eyebrow: string;
  title: React.ReactNode;
  body: string;
  imageSrc?: string;
  imageAlt?: string;
  href: string;
  cta: string;
}) {
  const styles = {
    white: {
      bg: "bg-white border border-slate-200",
      eyebrow: "text-slate-500",
      title: "text-slate-900",
      body: "text-slate-600",
      cta: "text-blue-700 hover:text-blue-800",
      arrow: "bg-blue-600 text-white",
    },
    blue: {
      bg: "bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-2xl shadow-blue-900/20",
      eyebrow: "text-blue-100/80",
      title: "text-white",
      body: "text-blue-50/90",
      cta: "text-white hover:text-blue-100",
      arrow: "bg-white text-blue-700",
    },
    dark: {
      bg: "bg-slate-900 text-white",
      eyebrow: "text-slate-400",
      title: "text-white",
      body: "text-slate-300",
      cta: "text-blue-300 hover:text-blue-200",
      arrow: "bg-blue-500 text-white",
    },
  }[variant];

  return (
    <article
      className={`group relative rounded-3xl p-7 lg:p-8 flex flex-col min-h-[26rem] overflow-hidden ${styles.bg}`}
    >
      <div className="flex items-start justify-between">
        <span className={`text-[11px] font-bold tracking-widest uppercase ${styles.eyebrow}`}>
          {eyebrow}
        </span>
        <span
          className={`inline-flex items-center justify-center w-9 h-9 rounded-full ${styles.arrow} transition-transform group-hover:rotate-45`}
        >
          <ArrowRightIcon className="w-4 h-4 -rotate-45" />
        </span>
      </div>

      {imageSrc && imageAlt ? (
        <div className="relative h-44 w-full my-5">
          <Image src={imageSrc} alt={imageAlt} fill sizes="(max-width:1024px) 100vw, 33vw" className="object-contain" />
        </div>
      ) : (
        <div className="my-5 h-44 flex items-center">
          <span className="text-[11rem] font-bold leading-none opacity-20 select-none">02</span>
        </div>
      )}

      <h3 className={`text-3xl lg:text-4xl font-bold leading-[1.05] tracking-tight ${styles.title}`}>
        {title}
      </h3>
      <p className={`mt-4 text-sm leading-relaxed ${styles.body}`}>{body}</p>

      <Link
        href={href}
        className={`mt-auto pt-6 inline-flex items-center gap-2 text-sm font-semibold ${styles.cta}`}
      >
        {cta}
        <ArrowRightIcon className="w-4 h-4" />
      </Link>
    </article>
  );
}

function MiniFeature({
  icon,
  title,
  body,
  imageSrc,
  imageAlt,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  imageSrc?: string;
  imageAlt?: string;
}) {
  return (
    <div className="group relative bg-white rounded-2xl border border-slate-200 p-6 hover:border-blue-300 hover:shadow-xl hover:shadow-blue-100/60 hover:-translate-y-1 transition-all overflow-hidden">
      {imageSrc ? (
        <div className="relative w-full aspect-[5/3] mb-4 -mx-2">
          <Image
            src={imageSrc}
            alt={imageAlt || ""}
            fill
            sizes="(max-width:768px) 100vw, 33vw"
            className="object-contain transition-transform duration-500 group-hover:scale-[1.04]"
          />
        </div>
      ) : (
        <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center mb-4">
          {icon}
        </div>
      )}
      <h3 className="font-semibold text-slate-900 mb-1.5">{title}</h3>
      <p className="text-sm text-slate-600 leading-relaxed">{body}</p>
    </div>
  );
}

function Testimonial({
  quote,
  name,
  role,
  avatarSrc,
}: {
  quote: string;
  name: string;
  role: string;
  avatarSrc: string;
}) {
  return (
    <article className="bg-white rounded-3xl p-7 border border-slate-200 hover:shadow-xl hover:shadow-blue-100/40 hover:border-blue-200 transition-all flex flex-col">
      <span className="text-blue-500 text-5xl font-bold leading-none select-none">&rdquo;</span>
      <p className="mt-3 text-slate-700 leading-relaxed flex-1">{quote}</p>
      <div className="mt-6 flex items-center gap-3">
        <div className="relative w-11 h-11 rounded-full overflow-hidden bg-blue-100 ring-2 ring-white shadow-sm shrink-0">
          <Image src={avatarSrc} alt={name} fill sizes="44px" className="object-cover" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">{name}</p>
          <p className="text-xs text-slate-500">{role}</p>
        </div>
      </div>
    </article>
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
      className={`rounded-3xl p-7 ${
        highlighted
          ? "bg-slate-900 text-white shadow-2xl shadow-blue-900/20 lg:scale-[1.03]"
          : "bg-white border border-slate-200"
      }`}
    >
      <p className={`text-sm font-semibold ${highlighted ? "text-blue-300" : "text-slate-500"}`}>
        {name}
      </p>
      <p className="mt-3 flex items-baseline gap-2">
        <span className={`text-4xl font-bold tracking-tight ${highlighted ? "text-white" : "text-slate-900"}`}>
          {price}
        </span>
        {cadence && (
          <span className={`text-sm ${highlighted ? "text-blue-200" : "text-slate-500"}`}>
            {cadence}
          </span>
        )}
      </p>
      <ul className="mt-6 space-y-2.5">
        {features.map((f) => (
          <li
            key={f}
            className={`flex items-center gap-2 text-sm ${highlighted ? "text-blue-50" : "text-slate-600"}`}
          >
            <CheckIcon className={`w-4 h-4 shrink-0 ${highlighted ? "text-blue-300" : "text-blue-500"}`} />
            {f}
          </li>
        ))}
      </ul>
      <Link
        href={ctaHref}
        className={`mt-7 w-full inline-flex items-center justify-center px-4 py-2.5 rounded-full font-semibold text-sm transition-colors ${
          highlighted
            ? "bg-white text-slate-900 hover:bg-blue-50"
            : "bg-blue-600 text-white hover:bg-blue-700"
        }`}
      >
        {cta}
      </Link>
    </div>
  );
}
