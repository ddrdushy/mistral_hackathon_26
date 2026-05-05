import Link from "next/link";
import {
  ArrowRightIcon,
  EnvelopeIcon,
  CalendarDaysIcon,
  ChatBubbleLeftRightIcon,
} from "@heroicons/react/24/outline";
import MarketingShell from "@/components/marketing/MarketingShell";

export const metadata = {
  title: "Contact — HireOps AI",
  description:
    "Talk to the HireOps team. Email, book a demo, or send us a quick note — we reply within one business day.",
};

const CHANNELS = [
  {
    icon: <EnvelopeIcon className="w-6 h-6" />,
    label: "Email",
    value: "founders@symprio.com",
    href: "mailto:founders@symprio.com",
    note: "Best for product questions, billing, anything we should fix.",
  },
  {
    icon: <CalendarDaysIcon className="w-6 h-6" />,
    label: "Book a demo",
    value: "30-minute walkthrough",
    href: "mailto:founders@symprio.com?subject=HireOps%20demo%20request",
    note: "We&apos;ll show HireOps on a fresh tenant and answer anything.",
  },
  {
    icon: <ChatBubbleLeftRightIcon className="w-6 h-6" />,
    label: "Sales & partnerships",
    value: "founders@symprio.com",
    href: "mailto:founders@symprio.com?subject=HireOps%20sales",
    note: "Volume discounts, agency tiers, integrations — talk to us.",
  },
];

export default function ContactPage() {
  return (
    <MarketingShell>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-blue-50 via-white to-blue-50">
        <div className="bg-blobs absolute inset-0 overflow-hidden pointer-events-none">
          <div className="blob-extra" />
        </div>
        <div className="relative max-w-4xl mx-auto px-6 pt-16 pb-12 lg:pt-24 lg:pb-16 text-center">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold tracking-widest uppercase text-blue-700 bg-white/60 ring-1 ring-blue-200 backdrop-blur-sm">
            Contact
          </span>
          <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-slate-900 leading-[1.05]">
            Let&apos;s{" "}
            <span className="bg-gradient-to-br from-blue-500 to-blue-700 bg-clip-text text-transparent">
              talk
            </span>
          </h1>
          <p className="mt-5 max-w-2xl mx-auto text-lg text-slate-600">
            Reach out for a demo, a quote, or just to tell us what you wish HireOps did. We
            reply within one business day.
          </p>
        </div>
      </section>

      {/* Form + channels */}
      <section className="py-12 lg:py-16 bg-white">
        <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-5 gap-10 lg:gap-14">
          {/* Form (mailto-based for now — no backend submit needed) */}
          <form
            action="mailto:founders@symprio.com"
            method="post"
            encType="text/plain"
            className="lg:col-span-3 bg-white rounded-3xl border border-slate-200 p-7 lg:p-9 shadow-sm"
          >
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">Send us a note</h2>
            <p className="mt-1 text-sm text-slate-500">
              Submitting opens your email app with the message pre-filled.
            </p>

            <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Your name" name="Name" type="text" required />
              <Field label="Work email" name="Email" type="email" required />
              <Field label="Company" name="Company" type="text" required />
              <Field
                label="Team size"
                name="Team size"
                type="text"
                placeholder="e.g. 1–10, 11–50, 51–200"
              />
            </div>
            <Field
              label="What can we help with?"
              name="Message"
              type="textarea"
              rows={5}
              placeholder="Tell us what you're trying to solve, where you're stuck, or what you'd like to see in a demo."
              required
            />

            <button
              type="submit"
              className="mt-7 inline-flex items-center justify-center gap-2 px-7 py-3 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/25"
            >
              Send message
              <ArrowRightIcon className="w-4 h-4" />
            </button>
          </form>

          {/* Channels */}
          <aside className="lg:col-span-2 space-y-4">
            {CHANNELS.map((c) => (
              <a
                key={c.label}
                href={c.href}
                className="block bg-white rounded-2xl border border-slate-200 p-6 hover:border-blue-300 hover:shadow-lg hover:shadow-blue-100/40 transition-all"
              >
                <div className="flex items-start gap-4">
                  <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-blue-100 text-blue-700 shrink-0">
                    {c.icon}
                  </span>
                  <div>
                    <p className="text-[11px] font-bold tracking-widest text-blue-600 uppercase">
                      {c.label}
                    </p>
                    <p className="mt-1 text-base font-semibold text-slate-900">{c.value}</p>
                    <p className="mt-1 text-sm text-slate-500" dangerouslySetInnerHTML={{ __html: c.note }} />
                  </div>
                </div>
              </a>
            ))}

            <div className="bg-gradient-to-br from-blue-500 to-blue-700 text-white rounded-2xl p-6 shadow-lg shadow-blue-900/20">
              <p className="text-[11px] font-bold tracking-widest uppercase text-blue-100">
                Already a customer?
              </p>
              <p className="mt-2 text-base font-semibold">
                Sign in for in-product help and live status.
              </p>
              <Link
                href="/login"
                className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-white hover:text-blue-100"
              >
                Go to dashboard
                <ArrowRightIcon className="w-4 h-4" />
              </Link>
            </div>
          </aside>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-blue-50/40">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Or just try it
          </h2>
          <p className="mt-3 text-slate-600">
            Free for the first 25 candidates. No credit card needed.
          </p>
          <Link
            href="/signup"
            className="mt-6 inline-flex items-center justify-center gap-2 px-7 py-3 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/25"
          >
            Start free trial
            <ArrowRightIcon className="w-4 h-4" />
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}

function Field({
  label,
  name,
  type,
  placeholder,
  required,
  rows,
}: {
  label: string;
  name: string;
  type: string;
  placeholder?: string;
  required?: boolean;
  rows?: number;
}) {
  const baseClass =
    "w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition";
  if (type === "textarea") {
    return (
      <div className="sm:col-span-2 mt-4">
        <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
        <textarea name={name} required={required} placeholder={placeholder} rows={rows ?? 4} className={baseClass} />
      </div>
    );
  }
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      <input type={type} name={name} required={required} placeholder={placeholder} className={baseClass} />
    </div>
  );
}
