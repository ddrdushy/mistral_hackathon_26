import Link from "next/link";
import { BriefcaseIcon } from "@heroicons/react/24/outline";
import CookieBanner from "./CookieBanner";

export default function MarketingShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/80 border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <span className="flex items-center justify-center w-8 h-8 bg-indigo-600 rounded-lg">
              <BriefcaseIcon className="w-5 h-5 text-white" />
            </span>
            <span className="font-semibold text-slate-900 tracking-tight">HireOps AI</span>
          </Link>
          <nav className="hidden md:flex items-center gap-7 text-sm text-slate-600">
            <Link href="/#features" className="hover:text-slate-900">Features</Link>
            <Link href="/pricing" className="hover:text-slate-900">Pricing</Link>
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

      <main className="flex-1">{children}</main>

      <footer className="border-t border-slate-200 py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-7 h-7 bg-indigo-600 rounded-md">
              <BriefcaseIcon className="w-4 h-4 text-white" />
            </span>
            <span className="text-sm text-slate-600">HireOps AI · A Symprio product</span>
          </div>
          <div className="flex items-center gap-5 text-sm text-slate-500">
            <Link href="/pricing" className="hover:text-slate-700">Pricing</Link>
            <Link href="/legal/privacy" className="hover:text-slate-700">Privacy</Link>
            <Link href="/legal/terms" className="hover:text-slate-700">Terms</Link>
            <Link href="/legal/cookies" className="hover:text-slate-700">Cookies</Link>
            <span className="text-xs text-slate-400">© {new Date().getFullYear()}</span>
          </div>
        </div>
      </footer>

      <CookieBanner />
    </div>
  );
}
