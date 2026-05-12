"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRightOnRectangleIcon,
  Bars3Icon,
  Cog6ToothIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/outline";
import Link from "next/link";
import AdminSidebar from "./AdminSidebar";
import { useAdmin } from "./AdminGate";
import { HelpProvider } from "@/components/help/HelpContext";
import FloatingHelpButton from "@/components/help/FloatingHelpButton";

/**
 * Visual shell for the platform-admin surface. Distinct from the tenant
 * DashboardShell — different sidebar, no HR menus. Sign-out lives in the
 * topbar avatar dropdown to match the tenant Topbar pattern.
 */
function initials(name: string, email: string): string {
  const source = (name || email || "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { me, logout } = useAdmin();

  useEffect(() => {
    const stored = localStorage.getItem("admin-sidebar-collapsed");
    if (stored === "true") setCollapsed(true);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  const handleMenuToggle = useCallback(() => setSidebarOpen((p) => !p), []);
  const handleToggleCollapse = useCallback(() => {
    setCollapsed((p) => {
      const next = !p;
      localStorage.setItem("admin-sidebar-collapsed", String(next));
      return next;
    });
  }, []);

  return (
    <HelpProvider>
    <div className="min-h-screen bg-slate-50">
      <AdminSidebar
        isOpen={sidebarOpen}
        collapsed={collapsed}
        onClose={() => setSidebarOpen(false)}
        onToggleCollapse={handleToggleCollapse}
      />

      <div
        className={`${collapsed ? "lg:pl-16" : "lg:pl-64"} flex flex-col min-h-screen transition-all duration-300`}
      >
        <header className="sticky top-0 z-20 flex items-center h-14 bg-white border-b border-slate-200 px-4 lg:px-6">
          <button
            type="button"
            onClick={handleMenuToggle}
            className="lg:hidden p-1.5 -ml-1.5 mr-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
            aria-label="Toggle sidebar"
          >
            <Bars3Icon className="w-5 h-5" />
          </button>
          <span className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
            Platform Admin
          </span>

          <div className="ml-auto flex items-center gap-2">
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center justify-center w-8 h-8 bg-indigo-600 text-white text-xs font-semibold rounded-full hover:bg-indigo-700 transition-colors"
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
                    <div className="mt-2 inline-flex items-center gap-1.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-semibold uppercase tracking-wide">
                        Superadmin
                      </span>
                      <span className="text-[10px] text-slate-400">v1.0.0</span>
                    </div>
                  </div>
                  <Link
                    href="/admin/settings"
                    onClick={() => setMenuOpen(false)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <Cog6ToothIcon className="w-4 h-4" />
                    Platform settings
                  </Link>
                  <Link
                    href="/admin/audit-log"
                    onClick={() => setMenuOpen(false)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <DocumentTextIcon className="w-4 h-4" />
                    Audit log
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

        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
      <FloatingHelpButton />
    </div>
    </HelpProvider>
  );
}
