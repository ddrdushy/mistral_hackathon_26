import Link from "next/link";
import { BriefcaseIcon, ArrowRightIcon } from "@heroicons/react/24/outline";
import CookieBanner from "./CookieBanner";

export default function MarketingShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-blue-50">
      {/* Floating pill navigation — fixed so it overlays the hero with no top gap */}
      <header className="fixed top-4 left-0 right-0 z-30 px-4">
        <div className="max-w-6xl mx-auto bg-white/85 backdrop-blur-md rounded-full shadow-sm ring-1 ring-slate-200/70">
          <div className="px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
            <Link href="/" className="inline-flex items-center gap-2.5 shrink-0">
              <span className="flex items-center justify-center w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg shadow-sm shadow-blue-500/30">
                <BriefcaseIcon className="w-5 h-5 text-white" />
              </span>
              <span className="font-bold text-slate-900 tracking-tight">HireOps AI</span>
            </Link>

            <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
              <Link href="/features" className="hover:text-slate-900 transition-colors">Features</Link>
              <Link href="/solutions" className="hover:text-slate-900 transition-colors">Solutions</Link>
              <Link href="/pricing" className="hover:text-slate-900 transition-colors">Pricing</Link>
              <Link href="/about" className="hover:text-slate-900 transition-colors">About</Link>
              <a
                href="https://symprio.com/contact"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-slate-900 transition-colors"
              >
                Contact
              </a>
              <Link href="/login" className="hover:text-slate-900 transition-colors">Sign in</Link>
            </nav>

            <Link
              href="/signup"
              className="group inline-flex items-center gap-1.5 pl-4 pr-3 py-2 rounded-full bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors whitespace-nowrap"
            >
              Start free
              <ArrowRightIcon className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* pt-20 reserves vertical space for the fixed pill nav so the first
          section starts cleanly below it (no overlap on first paint). */}
      <main className="flex-1 pt-20">{children}</main>

      <footer className="bg-slate-900 text-slate-300 mt-10">
        <div className="max-w-7xl mx-auto px-6 pt-16 pb-8">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-10 lg:gap-8">
            {/* Brand column */}
            <div className="col-span-2 sm:col-span-3 lg:col-span-2">
              <Link href="/" className="inline-flex items-center gap-2.5">
                <span className="flex items-center justify-center w-9 h-9 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg shadow-lg shadow-blue-900/40">
                  <BriefcaseIcon className="w-5 h-5 text-white" />
                </span>
                <span className="font-bold text-white tracking-tight text-lg">HireOps AI</span>
              </Link>
              <p className="mt-4 text-sm text-slate-400 leading-relaxed max-w-xs">
                The AI recruiting OS — from inbox to hired, on autopilot. A Symprio product.
              </p>
              <a
                href="https://symprio.com"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-300 hover:text-blue-200 transition-colors"
              >
                Visit symprio.com
                <ArrowRightIcon className="w-3 h-3" />
              </a>
            </div>

            {/* Product */}
            <div>
              <h4 className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-4">Product</h4>
              <ul className="space-y-2.5 text-sm">
                <li><Link href="/features" className="hover:text-white transition-colors">Features</Link></li>
                <li><Link href="/solutions" className="hover:text-white transition-colors">Solutions</Link></li>
                <li><Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link></li>
                <li><Link href="/login" className="hover:text-white transition-colors">Sign in</Link></li>
              </ul>
            </div>

            {/* Company */}
            <div>
              <h4 className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-4">Company</h4>
              <ul className="space-y-2.5 text-sm">
                <li><Link href="/about" className="hover:text-white transition-colors">About</Link></li>
                <li>
                  <a href="https://symprio.com/contact" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
                    Contact
                  </a>
                </li>
                <li>
                  <a href="https://symprio.com" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
                    Symprio
                  </a>
                </li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-4">Legal</h4>
              <ul className="space-y-2.5 text-sm">
                <li><Link href="/legal/privacy" className="hover:text-white transition-colors">Privacy</Link></li>
                <li><Link href="/legal/terms" className="hover:text-white transition-colors">Terms</Link></li>
                <li><Link href="/legal/cookies" className="hover:text-white transition-colors">Cookies</Link></li>
              </ul>
            </div>
          </div>

          <div className="mt-12 pt-8 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              © {new Date().getFullYear()} Symprio · All rights reserved
            </p>
            <p className="text-xs text-slate-500">
              Powered by <span className="text-slate-300">Mistral AI</span> &amp;{" "}
              <span className="text-slate-300">ElevenLabs</span>
            </p>
          </div>
        </div>
      </footer>

      <CookieBanner />
    </div>
  );
}
