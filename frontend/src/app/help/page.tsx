import Link from "next/link";
import {
  LifebuoyIcon,
  EnvelopeIcon,
  KeyIcon,
  CreditCardIcon,
  ChatBubbleLeftRightIcon,
  ArrowLeftIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";

/**
 * Public help page — reachable WITHOUT login from /login, /signup,
 * /forgot-password, footer of every marketing page, and the
 * 'Need help?' link in the auth-layout header. Closes the audit
 * gap: locked-out users now have a clear path to ask for help.
 *
 * Intentionally minimal — three things only:
 *   1. Self-serve answers to the most common stuck-on-auth cases
 *   2. A mailto: link to a real support inbox
 *   3. Quick-jumps to /forgot-password, /signup, /login
 */

const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@hireops.symprio.com";

const FAQ = [
  {
    icon: KeyIcon,
    title: "I forgot my password",
    body: (
      <>
        Use the reset flow at{" "}
        <Link href="/forgot-password" className="text-indigo-600 hover:underline">
          /forgot-password
        </Link>
        . You&apos;ll get a single-use reset link in your inbox within a
        minute. Check spam if it doesn&apos;t arrive — corporate inboxes
        sometimes route automated mail to quarantine.
      </>
    ),
  },
  {
    icon: EnvelopeIcon,
    title: "My verification email never arrived",
    body: (
      <>
        Sign in at{" "}
        <Link href="/login" className="text-indigo-600 hover:underline">
          /login
        </Link>{" "}
        and click <span className="font-semibold">Resend verification email</span>{" "}
        on the post-signup screen. If it still doesn&apos;t arrive, your
        company&apos;s mail server may be filtering us — email us from a
        different address and we can verify your account manually.
      </>
    ),
  },
  {
    icon: CreditCardIcon,
    title: "Billing or invoice question",
    body: (
      <>
        Stripe is our payment processor. Your tenant&apos;s billing page
        (<span className="font-mono text-xs">/settings/billing</span> once
        logged in) shows the live subscription. For invoice corrections,
        plan changes outside the catalog, or refund requests, email us at
        the address below.
      </>
    ),
  },
  {
    icon: ExclamationTriangleIcon,
    title: "Something looks broken / I hit an error",
    body: (
      <>
        Take a screenshot if you can, note the URL, and send it to support.
        We&apos;ll triage within one business day — urgent production
        issues get same-day attention.
      </>
    ),
  },
];

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar — matches the auth layout so the experience is consistent */}
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back to home
          </Link>
          <Link
            href="/login"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            Sign in →
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="flex items-center gap-3 mb-3">
          <span className="flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-100 text-indigo-700">
            <LifebuoyIcon className="w-6 h-6" />
          </span>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Need a hand?</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              The fastest paths to unstuck — pick the closest match.
            </p>
          </div>
        </div>

        {/* FAQ cards */}
        <div className="mt-8 grid grid-cols-1 gap-3">
          {FAQ.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="bg-white border border-slate-200 rounded-xl p-5"
            >
              <div className="flex items-start gap-3">
                <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-slate-50 text-slate-600 shrink-0">
                  <Icon className="w-5 h-5" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
                  <p className="text-sm text-slate-600 leading-relaxed mt-1">
                    {body}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Contact card */}
        <div className="mt-8 bg-gradient-to-br from-indigo-50 via-white to-violet-50 border border-indigo-200 rounded-xl p-6">
          <div className="flex items-start gap-3">
            <span className="flex items-center justify-center w-10 h-10 rounded-lg bg-indigo-600 text-white shrink-0">
              <ChatBubbleLeftRightIcon className="w-5 h-5" />
            </span>
            <div className="flex-1">
              <h2 className="text-base font-bold text-slate-900">
                Talk to a real person
              </h2>
              <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                Email{" "}
                <a
                  href={`mailto:${SUPPORT_EMAIL}?subject=HireOps%20support%20request`}
                  className="font-semibold text-indigo-700 hover:underline"
                >
                  {SUPPORT_EMAIL}
                </a>{" "}
                with a description of what you&apos;re trying to do, your
                account email if you have one, and any screenshots. We
                respond within one business day.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href={`mailto:${SUPPORT_EMAIL}?subject=HireOps%20support%20request`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
                >
                  <EnvelopeIcon className="w-4 h-4" />
                  Email us
                </a>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50"
                >
                  Sign in to file a ticket
                </Link>
              </div>
              <p className="text-[11px] text-slate-500 mt-3 leading-snug">
                Already have an account? Once signed in, file a ticket from{" "}
                <span className="font-mono">/support</span> for an audit
                trail and reply notifications.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export const metadata = {
  title: "Help — HireOps AI",
  description: "Get unstuck. Pre-login support paths for password resets, billing, and bug reports.",
};
