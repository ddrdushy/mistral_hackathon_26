import Link from "next/link";
import {
  ArrowRightIcon,
  BoltIcon,
  EyeIcon,
  HeartIcon,
  LockClosedIcon,
} from "@heroicons/react/24/outline";
import MarketingShell from "@/components/marketing/MarketingShell";
import Reveal from "@/components/marketing/Reveal";

export const metadata = {
  title: "About — HireOps AI",
  description:
    "Hiring shouldn't be a full-time job for everyone in the room. We're building the AI recruiting OS so people teams can spend their time on people.",
};

const PRINCIPLES = [
  {
    icon: <BoltIcon className="w-6 h-6" />,
    title: "Faster than a human, when it should be",
    body:
      "Most candidates wait days for a reply. We make sure the first response is in minutes — and that the right humans see the right candidates first.",
  },
  {
    icon: <EyeIcon className="w-6 h-6" />,
    title: "Explainable, not magical",
    body:
      "Every score has evidence. Every decision has a reason. If a model rejected someone, you can see exactly what it saw — no black box.",
  },
  {
    icon: <LockClosedIcon className="w-6 h-6" />,
    title: "Tenant-isolated by default",
    body:
      "Your candidates' data is yours. Multi-tenancy is at the database level, not a flag in code. GDPR export and hard-delete are first-class features, not paid add-ons.",
  },
  {
    icon: <HeartIcon className="w-6 h-6" />,
    title: "Augment, don't replace",
    body:
      "AI handles the volume. Humans handle the judgment. We optimise for the moment a recruiter looks at a shortlist and says: yep, these are the people.",
  },
];

export default function AboutPage() {
  return (
    <MarketingShell>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-blue-50 via-white to-blue-50">
        <div className="bg-blobs absolute inset-0 overflow-hidden pointer-events-none">
          <div className="blob-extra" />
        </div>
        <div className="relative max-w-4xl mx-auto px-6 pt-16 pb-20 lg:pt-24 lg:pb-24 text-center">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold tracking-widest uppercase text-blue-700 bg-white/60 ring-1 ring-blue-200 backdrop-blur-sm">
            About
          </span>
          <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-slate-900 leading-[1.05]">
            Hiring shouldn&apos;t be a full-time job{" "}
            <span className="bg-gradient-to-br from-blue-500 via-blue-600 to-blue-800 bg-clip-text text-transparent animate-gradient-sweep">
              for everyone in the room
            </span>
          </h1>
          <p className="mt-6 max-w-2xl mx-auto text-lg text-slate-600 leading-relaxed">
            We&apos;re building the AI recruiting OS so people teams can spend their time on
            people — not on inboxes.
          </p>
        </div>
      </section>

      {/* Mission */}
      <section className="py-16 lg:py-24 bg-white">
        <div className="max-w-4xl mx-auto px-6">
          <div className="prose prose-lg prose-slate max-w-none">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">Why we built HireOps</h2>
            <p className="text-lg text-slate-600 leading-relaxed mt-4">
              Every people team we&apos;ve worked with describes the same problem: too much
              admin, not enough hiring. Resumes pile up. Inboxes drift. Strong candidates ghost
              because we took three days to reply. The team that&apos;s supposed to be picking
              great humans is instead spending Monday morning sorting attachments.
            </p>
            <p className="text-lg text-slate-600 leading-relaxed mt-4">
              The newest generation of AI changes the maths. Mistral can read a resume against a
              JD and tell you exactly why it&apos;s a 78. ElevenLabs can hold a real-time voice
              interview that feels like a phone screen. Webcam tracking can flag the integrity
              issues a remote process can&apos;t see. None of this needed to wait for a $50M
              series A — we just needed to wire the pieces together with care.
            </p>
            <p className="text-lg text-slate-600 leading-relaxed mt-4">
              That&apos;s HireOps. The boring parts of hiring, automated. The interesting parts,
              accelerated. The decisions, still yours.
            </p>
          </div>
        </div>
      </section>

      {/* Principles */}
      <section className="py-16 lg:py-24 bg-blue-50/40 relative overflow-hidden">
        <div className="bg-blobs absolute inset-0 overflow-hidden pointer-events-none opacity-50">
          <div className="blob-extra" />
        </div>
        <div className="relative max-w-6xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="text-[11px] font-bold tracking-widest text-blue-600 uppercase">
              How we build
            </span>
            <h2 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
              Four principles, every release
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {PRINCIPLES.map((p, i) => (
              <Reveal key={p.title} delay={i * 100}>
                <div className="bg-white rounded-2xl border border-slate-200 p-7 h-full transition-all hover:shadow-lg hover:shadow-blue-100/50 hover:border-blue-200">
                  <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center mb-4">
                    {p.icon}
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 tracking-tight">{p.title}</h3>
                  <p className="mt-2 text-sm text-slate-600 leading-relaxed">{p.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Symprio parent */}
      <section className="py-16 lg:py-20 bg-white">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <span className="text-[11px] font-bold tracking-widest text-blue-600 uppercase">
            A Symprio product
          </span>
          <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Built by the team behind Symprio
          </h2>
          <p className="mt-4 text-slate-600 leading-relaxed">
            HireOps is part of the Symprio family of AI-powered automation products. Symprio
            helps enterprise teams move faster with agentic AI — from RPA replacements to
            entire digital workforces. HireOps is what happens when we point that machinery at
            the part of work that matters most: who joins the team next.
          </p>
          <a
            href="https://symprio.com"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex items-center gap-2 text-blue-600 font-semibold hover:text-blue-700"
          >
            Visit symprio.com
            <ArrowRightIcon className="w-4 h-4" />
          </a>
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-20 overflow-hidden bg-gradient-to-br from-blue-600 via-blue-700 to-slate-900">
        <div className="bg-blobs absolute inset-0 overflow-hidden opacity-30 pointer-events-none">
          <div className="blob-extra" />
        </div>
        <div className="relative max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            Try it on your next hire
          </h2>
          <p className="mt-4 text-lg text-blue-100">
            Free for the first 25 candidates. No credit card.
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
              Get in touch
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
