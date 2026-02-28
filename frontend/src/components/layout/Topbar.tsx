"use client";

import { usePathname } from "next/navigation";
import {
  Bars3Icon,
  MagnifyingGlassIcon,
  BellIcon,
} from "@heroicons/react/24/outline";

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

export default function Topbar({ onMenuToggle }: TopbarProps) {
  const pathname = usePathname();
  const pageTitle = getPageTitle(pathname);

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
        {/* Search input (decorative) */}
        <div className="hidden md:flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2">
          <MagnifyingGlassIcon className="w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search..."
            className="bg-transparent text-sm text-slate-700 placeholder-slate-400 outline-none w-48"
            readOnly
          />
        </div>

        {/* Notification bell */}
        <button
          type="button"
          className="relative p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          aria-label="Notifications"
        >
          <BellIcon className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-600 rounded-full" />
        </button>

        {/* User avatar */}
        <div className="flex items-center justify-center w-8 h-8 bg-blue-600 text-white text-sm font-semibold rounded-full cursor-pointer">
          HR
        </div>
      </div>
    </header>
  );
}
