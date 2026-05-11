"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Bars3Icon,
  MagnifyingGlassIcon,
  BellIcon,
  QuestionMarkCircleIcon,
  ArrowRightOnRectangleIcon,
  UsersIcon,
  CreditCardIcon,
  ShieldCheckIcon,
  LifebuoyIcon,
} from "@heroicons/react/24/outline";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthGate";
import HelpDrawer from "@/components/help/HelpDrawer";
import { resolveHelp } from "@/lib/help/registry";

interface TopbarProps {
  onMenuToggle: () => void;
}

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/inbox": "Inbox",
  "/jobs": "Jobs",
  "/jobs/new": "Create Job",
  "/candidates": "Candidates",
  "/reports": "Reports",
};

function getPageTitle(pathname: string): string {
  // Check for exact match first
  if (pageTitles[pathname]) {
    return pageTitles[pathname];
  }

  // Check for dynamic routes like /candidates/[id]
  if (pathname.startsWith("/candidates/")) {
    return "Candidate Detail";
  }

  // Fallback: capitalize the first segment
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length > 0) {
    return segments[0].charAt(0).toUpperCase() + segments[0].slice(1);
  }

  return "Dashboard";
}

function initials(name: string, email: string): string {
  const source = (name || email || "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export default function Topbar({ onMenuToggle }: TopbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const urlParams = useSearchParams();
  const pageTitle = getPageTitle(pathname);
  const { me, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Pre-fill from URL when the user is already on /candidates with a
  // search active — so refocusing the top bar shows their current term.
  const [search, setSearch] = useState(
    pathname === "/candidates" ? urlParams.get("search") || "" : "",
  );
  useEffect(() => {
    setSearch(
      pathname === "/candidates" ? urlParams.get("search") || "" : "",
    );
  }, [pathname, urlParams]);

  const [helpOpen, setHelpOpen] = useState(false);
  const helpEntry = resolveHelp(pathname || "");

  const submitSearch = () => {
    const q = search.trim();
    if (!q) {
      router.push("/candidates");
      return;
    }
    router.push(`/candidates?search=${encodeURIComponent(q)}`);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // Topbar is only rendered inside AuthGate which guarantees me is set,
  // but guard for type-safety + render-during-redirect edge cases.
  if (!me) return null;

  return (
    <header className="sticky top-0 z-20 flex items-center h-16 bg-white border-b border-slate-200 px-4 lg:px-6">
      {/* Mobile menu button */}
      <button
        type="button"
        onClick={onMenuToggle}
        className="lg:hidden p-2 -ml-2 mr-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
        aria-label="Toggle sidebar"
      >
        <Bars3Icon className="w-6 h-6" />
      </button>

      {/* Page title */}
      <h1 className="text-lg font-semibold text-slate-900 truncate">
        {pageTitle}
      </h1>

      {/* Right section */}
      <div className="ml-auto flex items-center gap-3">
        {/* Search input — submits to /candidates?search=... on Enter */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitSearch();
          }}
          className="hidden md:flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-300 transition-colors"
        >
          <button
            type="submit"
            aria-label="Search candidates"
            className="text-slate-400 hover:text-slate-600"
          >
            <MagnifyingGlassIcon className="w-4 h-4" />
          </button>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search candidates..."
            aria-label="Search candidates"
            className="bg-transparent text-sm text-slate-700 placeholder-slate-400 outline-none w-48"
          />
        </form>

        {/* Help — opens the contextual drawer for the current page */}
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
          aria-label="Help for this page"
          title={`Help: ${helpEntry.title}`}
        >
          <QuestionMarkCircleIcon className="w-5 h-5" />
        </button>

        {/* Notification bell */}
        <button
          type="button"
          className="relative p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          aria-label="Notifications"
        >
          <BellIcon className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-600 rounded-full" />
        </button>

        {/* User menu */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center justify-center w-8 h-8 bg-indigo-600 text-white text-sm font-semibold rounded-full hover:bg-indigo-700 transition-colors"
            aria-label="Account menu"
          >
            {initials(me.user.name, me.user.email)}
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-64 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-50">
              <div className="px-4 py-3 border-b border-slate-100">
                <p className="text-sm font-semibold text-slate-900 truncate">
                  {me.user.name || me.user.email.split("@")[0]}
                </p>
                <p className="text-xs text-slate-500 truncate">{me.user.email}</p>
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">Workspace</span>
                  <span className="text-xs font-medium text-slate-700 truncate">{me.tenant.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-semibold uppercase">
                    {me.tenant.plan}
                  </span>
                </div>
                {!me.user.email_verified && (
                  <p className="mt-2 text-[11px] text-amber-600">
                    ⚠ Email not verified
                  </p>
                )}
              </div>
              {me.user.is_superadmin && (
                <Link
                  href="/admin"
                  onClick={() => setMenuOpen(false)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-indigo-700 bg-indigo-50/60 hover:bg-indigo-100 transition-colors border-b border-indigo-100"
                >
                  <ShieldCheckIcon className="w-4 h-4" />
                  Platform Admin
                </Link>
              )}
              <Link
                href="/settings/team"
                onClick={() => setMenuOpen(false)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <UsersIcon className="w-4 h-4" />
                Team
              </Link>
              <Link
                href="/settings/billing"
                onClick={() => setMenuOpen(false)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <CreditCardIcon className="w-4 h-4" />
                Billing & usage
              </Link>
              <Link
                href="/support"
                onClick={() => setMenuOpen(false)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <LifebuoyIcon className="w-4 h-4" />
                Help & support
              </Link>
              <button
                type="button"
                onClick={logout}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors border-t border-slate-100"
              >
                <ArrowRightOnRectangleIcon className="w-4 h-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      <HelpDrawer
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        entry={helpEntry}
      />
    </header>
  );
}
