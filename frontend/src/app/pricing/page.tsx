import Link from "next/link";
import { CheckIcon, MinusIcon } from "@heroicons/react/24/outline";
import MarketingShell from "@/components/marketing/MarketingShell";

export const metadata = {
  title: "Pricing — HireOps AI",
  description:
    "Simple, fair pricing for AI recruiting. Start free with 25 candidates. Scale up only when you need to.",
};

interface PlanRow {
  name: string;
  price: string;
  cadence: string;
  blurb: string;
  cta: string;
  ctaHref: string;
  highlighted?: boolean;
}

const SALES_EMAIL = "sales@symprio.com";
const mailtoSales = (subject: string) =>
  `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(subject)}`;

const PLANS: PlanRow[] = [
  {
    name: "Trial",
    price: "$0",
    cadence: "free",
    blurb: "Try the full product. No card required, no time limit.",
    cta: "Start trial",
    ctaHref: "/signup",
    highlighted: true,
  },
  {
    name: "Starter",
    price: "$49",
    cadence: "/ month",
    blurb: "For small teams hiring a handful of roles per quarter.",
    cta: "Contact sales",
    ctaHref: mailtoSales("Interested in HireOps Starter"),
  },
  {
    name: "Pro",
    price: "$199",
    cadence: "/ month",
    blurb: "For active recruiters with continuous pipelines.",
    cta: "Contact sales",
    ctaHref: mailtoSales("Interested in HireOps Pro"),
  },
];

interface FeatureRow {
  category: string;
  rows: { label: string; values: [string | boolean, string | boolean, string | boolean] }[];
}

const FEATURES: FeatureRow[] = [
  {
    category: "Limits",
    rows: [
      { label: "Active jobs", values: ["5", "25", "Unlimited"] },
      { label: "Candidates", values: ["25", "250", "Unlimited"] },
      { label: "Interviews / month", values: ["10", "100", "Unlimited"] },
      { label: "Team seats", values: ["1", "5", "Unlimited"] },
    ],
  },
  {
    category: "AI features",
    rows: [
      { label: "Email auto-classification", values: [true, true, true] },
      { label: "Resume scoring (Mistral)", values: [true, true, true] },
      { label: "Q&A interviews (MCQ + free-form)", values: [true, true, true] },
      { label: "Voice interviews (ElevenLabs)", values: [true, true, true] },
      { label: "Anti-fraud signals (face + tab + paste)", values: [true, true, true] },
    ],
  },
  {
    category: "Hiring workflow",
    rows: [
      { label: "Threshold-based auto-decisions", values: [true, true, true] },
      { label: "AI hiring report per candidate", values: [true, true, true] },
      { label: "CSV export", values: [true, true, true] },
      { label: "Branded interview emails", values: [false, true, true] },
      { label: "Calendar invites (.ics)", values: [true, true, true] },
    ],
  },
  {
    category: "Support & security",
    rows: [
      { label: "Community support", values: [true, true, true] },
      { label: "Priority email support", values: [false, true, true] },
      { label: "SSO (coming soon)", values: [false, false, true] },
      { label: "Audit logs (coming soon)", values: [false, false, true] },
    ],
  },
];

const FAQ = [
  {
    q: "Do I need a credit card to sign up?",
    a: "No. Start the Trial with just an email — no card, no time limit. Upgrade only when you're ready.",
  },
  {
    q: "How do I move to Starter or Pro?",
    a: "Email sales@symprio.com or click Contact sales above. We'll set up monthly invoicing connected to your Stripe account so billing matches your finance team's existing flow.",
  },
  {
    q: "What happens if I exceed a quota on the Trial?",
    a: "Existing data stays. You'll see an 'Upgrade to add more' prompt — talk to sales and we'll have you on a paid plan within a day.",
  },
  {
    q: "Is my candidates' data safe?",
    a: "Each tenant's data is isolated by tenant_id at the database level. We use Mistral and ElevenLabs APIs but don't share your data with anyone else. See our Privacy policy for details.",
  },
  {
    q: "How does monthly billing work?",
    a: "Once you're on a paid plan we connect to your Stripe account and invoice monthly — same payment method, same billing cycle, no separate vendor portal to manage.",
  },
  {
    q: "Do you offer annual billing, discounts, or custom plans?",
    a: "Yes. Email sales@symprio.com — we'll tailor pricing for startups (under 10 employees), agencies, and enterprise rollouts.",
  },
];

export default function PricingPage() {
  return (
    <MarketingShell>
      {/* Hero */}
      <section className="relative">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-blue-50 -z-10" />
        <div className="max-w-6xl mx-auto px-6 pt-16 pb-12 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 tracking-tight">
            Simple, fair pricing
          </h1>
          <p className="mt-4 text-lg text-slate-600 max-w-2xl mx-auto">
            Start with a free trial. When you outgrow it, talk to sales — we&apos;ll
            tailor a plan and bill monthly through your Stripe account.
          </p>
        </div>
      </section>

      {/* Plan cards */}
      <section className="max-w-6xl mx-auto px-6 -mt-4 mb-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={`rounded-2xl p-6 ${
                p.highlighted
                  ? "bg-slate-900 text-white shadow-2xl shadow-blue-900/10"
                  : "bg-white border border-slate-200 shadow-sm"
              }`}
            >
              {p.highlighted && (
                <span className="inline-block text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-blue-500 text-white mb-2">
                  Recommended
                </span>
              )}
              <p
                className={`text-sm font-semibold ${p.highlighted ? "text-blue-300" : "text-slate-500"}`}
              >
                {p.name}
              </p>
              <p className="mt-2 flex items-baseline gap-1.5">
                <span
                  className={`text-4xl font-bold ${p.highlighted ? "text-white" : "text-slate-900"}`}
                >
                  {p.price}
                </span>
                <span
                  className={`text-sm ${p.highlighted ? "text-blue-200" : "text-slate-500"}`}
                >
                  {p.cadence}
                </span>
              </p>
              <p
                className={`mt-2 text-sm ${p.highlighted ? "text-blue-100" : "text-slate-600"}`}
              >
                {p.blurb}
              </p>
              <Link
                href={p.ctaHref}
                className={`mt-5 w-full inline-flex items-center justify-center px-4 py-2.5 rounded-full font-semibold text-sm transition-colors ${
                  p.highlighted
                    ? "bg-white text-slate-900 hover:bg-slate-100"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                {p.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Comparison table */}
      <section className="max-w-6xl mx-auto px-6 mb-20">
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-6 text-center">
          Compare plans
        </h2>
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left font-semibold text-slate-700 px-6 py-4 w-1/3"></th>
                <th className="text-center font-semibold text-slate-700 px-6 py-4 bg-blue-50/50">Trial</th>
                <th className="text-center font-semibold text-slate-700 px-6 py-4">Starter</th>
                <th className="text-center font-semibold text-slate-700 px-6 py-4">Pro</th>
              </tr>
            </thead>
            <tbody>
              {FEATURES.flatMap((cat) => [
                <tr key={`${cat.category}-header`} className="bg-slate-50/60">
                  <td
                    colSpan={4}
                    className="px-6 py-2 text-[11px] uppercase tracking-wider font-semibold text-slate-500"
                  >
                    {cat.category}
                  </td>
                </tr>,
                ...cat.rows.map((row, i) => (
                  <tr key={`${cat.category}-${i}`} className="border-t border-slate-100">
                    <td className="px-6 py-3 text-slate-700">{row.label}</td>
                    {row.values.map((v, j) => (
                      <td
                        key={j}
                        className={`px-6 py-3 text-center ${
                          j === 0 ? "bg-blue-50/30" : ""
                        }`}
                      >
                        {typeof v === "boolean" ? (
                          v ? (
                            <CheckIcon className="w-4 h-4 text-emerald-600 mx-auto" />
                          ) : (
                            <MinusIcon className="w-4 h-4 text-slate-300 mx-auto" />
                          )
                        ) : (
                          <span className="text-slate-700 font-medium">{v}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-6 mb-20">
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-6 text-center">
          Frequently asked
        </h2>
        <dl className="space-y-4">
          {FAQ.map((item) => (
            <div
              key={item.q}
              className="bg-white rounded-xl border border-slate-200 p-5"
            >
              <dt className="font-semibold text-slate-900">{item.q}</dt>
              <dd className="mt-1.5 text-sm text-slate-600 leading-relaxed">{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-br from-blue-600 via-blue-700 to-slate-900 py-14">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-bold text-white tracking-tight">
            Start your trial today
          </h2>
          <p className="mt-3 text-blue-100">
            Free, no card required. Talk to sales when you&apos;re ready to scale.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center px-6 py-3 rounded-full bg-white text-blue-700 font-semibold hover:bg-blue-50 transition-colors shadow-sm"
            >
              Start trial
            </Link>
            <a
              href={mailtoSales("Contact HireOps sales")}
              className="inline-flex items-center justify-center px-6 py-3 rounded-full bg-transparent text-white font-semibold border border-white/40 hover:bg-white/10 transition-colors"
            >
              Contact sales
            </a>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
