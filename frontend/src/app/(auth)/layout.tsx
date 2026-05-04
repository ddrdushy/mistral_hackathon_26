import { BriefcaseIcon } from "@heroicons/react/24/outline";
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="px-6 py-4 border-b border-slate-200 bg-white">
        <Link href="/" className="inline-flex items-center gap-2.5">
          <span className="flex items-center justify-center w-8 h-8 bg-indigo-600 rounded-lg">
            <BriefcaseIcon className="w-5 h-5 text-white" />
          </span>
          <span className="font-semibold text-slate-900 tracking-tight">HireOps AI</span>
        </Link>
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">{children}</div>
      </main>
      <footer className="px-6 py-4 text-center text-xs text-slate-400">
        <span>© {new Date().getFullYear()} Symprio · </span>
        <Link href="/legal/privacy" className="hover:text-slate-600">Privacy</Link>
        <span> · </span>
        <Link href="/legal/terms" className="hover:text-slate-600">Terms</Link>
      </footer>
    </div>
  );
}
