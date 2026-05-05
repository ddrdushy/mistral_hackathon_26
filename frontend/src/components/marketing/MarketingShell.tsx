import Link from "next/link";
import { BriefcaseIcon, ArrowRightIcon } from "@heroicons/react/24/outline";
import CookieBanner from "./CookieBanner";

export default function MarketingShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white min-h-screen flex flex-col">
      {/* Floating pill navigation, Symprio-style */}
      <header className="sticky top-4 z-30 px-4">
        <div className="max-w-6xl mx-auto bg-white/85 backdrop-blur-md rounded-full shadow-sm ring-1 ring-slate-200/70">
          <div className="px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
            <Link href="/" className="inline-flex items-center gap-2.5 shrink-0">
              <span className="flex items-center justify-center w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg shadow-sm shadow-blue-500/30">
                <BriefcaseIcon className="w-5 h-5 text-white" />
              </span>
              <span className="font-bold text-slate-900 tracking-tight">HireOps AI</span>
            </Link>

            <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
              <Link href="/#how-it-works" className="hover:text-slate-900 transition-colors">How it works</Link>
              <Link href="/pricing" className="hover:text-slate-900 transition-colors">Pricing</Link>
              <Link href="/login" className="hover:text-slate-900 transition-colors">Sign in</Link>
            </nav>

            <Link
              href="/signup"
              className="group inline-flex items-center gap-1.5 pl-4 pr-3 py-2 rounded-full bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
            >
              Start free
              <ArrowRightIcon className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-slate-200 py-10 mt-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-7 h-7 bg-gradient-to-br from-blue-500 to-blue-700 rounded-md">
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
