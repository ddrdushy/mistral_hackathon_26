"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  Bars3Icon,
  MagnifyingGlassIcon,
  QuestionMarkCircleIcon,
  ArrowRightOnRectangleIcon,
  UsersIcon,
  CreditCardIcon,
  ShieldCheckIcon,
  LifebuoyIcon,
} from "@heroicons/react/24/outline";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthGate";
import { useHelp } from "@/components/help/HelpContext";
import TopbarSearch from "./TopbarSearch";
import NotificationBell from "./NotificationBell";

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
  const pageTitle = getPageTitle(pathname);
  const { me, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const help = useHelp();

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
      <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
        {/* Live candidate search with dropdown of top matches (desktop). */}
        <TopbarSearch />

        {/* Mobile-only search trigger — opens the global command
            palette, which on a touch device acts as the search surface
            since the desktop input is hidden. */}
        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("commandpalette:open"));
            }
          }}
          className="md:hidden p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
          aria-label="Search"
        >
          <MagnifyingGlassIcon className="w-5 h-5" />
        </button>

        {/* Help — opens the contextual drawer for the current page. */}
        <button
          type="button"
          onClick={() => help.open()}
          className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
          aria-label="Help for this page"
          title={`Help: ${help.entry.title}`}
        >
          <QuestionMarkCircleIcon className="w-5 h-5" />
        </button>

        {/* Notification bell — dropdown lives in the component. */}
        <NotificationBell />

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
    </header>
  );
}
