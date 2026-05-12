import Link from "next/link";
import {
  ExclamationTriangleIcon,
  ArrowLeftIcon,
  LifebuoyIcon,
  HomeIcon,
} from "@heroicons/react/24/outline";

/**
 * Custom 404 page. Replaces Next.js's default dead-end response with
 * something that actually helps the user get back on track:
 *   - Home + Sign in + Help quick-jumps
 *   - Mailto link as a last resort
 *
 * Closes the audit gap where a mistyped URL left users stranded with
 * no support path.
 */

const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@hireops.symprio.com";

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-12">
      <div className="max-w-md w-full text-center">
        <span className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-100 text-amber-700 mb-5">
          <ExclamationTriangleIcon className="w-8 h-8" />
        </span>
        <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          404
        </p>
        <h1 className="text-3xl font-bold text-slate-900 mt-1">
          We can&apos;t find that page
        </h1>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          The URL may have been mistyped, the page might have been moved, or
          you may have followed a stale link from an email.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
          >
            <HomeIcon className="w-4 h-4" />
            Go to dashboard
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50"
          >
            Sign in
          </Link>
          <Link
            href="/help"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50"
          >
            <LifebuoyIcon className="w-4 h-4" />
            Get help
          </Link>
        </div>

        <p className="mt-6 text-xs text-slate-500">
          Think this is a bug?{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=404%20on%20HireOps&body=I%20landed%20on%20a%20404%20at%3A%20${encodeURIComponent(
              "(paste URL here)",
            )}`}
            className="text-indigo-600 hover:underline"
          >
            Email us
          </a>{" "}
          with the URL and we&apos;ll redirect or fix it.
        </p>

        <Link
          href="/"
          className="mt-8 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
        >
          <ArrowLeftIcon className="w-3.5 h-3.5" />
          Back to home
        </Link>
      </div>
    </div>
  );
}

export const metadata = {
  title: "Page not found — HireOps AI",
};
