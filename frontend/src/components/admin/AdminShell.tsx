"use client";

import { useState, useCallback, useEffect } from "react";
import { Bars3Icon } from "@heroicons/react/24/outline";
import AdminSidebar from "./AdminSidebar";
import { useAdmin } from "./AdminGate";

/**
 * Visual shell for the platform-admin surface. Distinct from the tenant
 * DashboardShell — different sidebar, no HR menus.
 */
export default function AdminShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { me } = useAdmin();

  useEffect(() => {
    const stored = localStorage.getItem("admin-sidebar-collapsed");
    if (stored === "true") setCollapsed(true);
  }, []);

  const handleMenuToggle = useCallback(() => {
    setSidebarOpen((p) => !p);
  }, []);

  const handleToggleCollapse = useCallback(() => {
    setCollapsed((p) => {
      const next = !p;
      localStorage.setItem("admin-sidebar-collapsed", String(next));
      return next;
    });
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminSidebar
        isOpen={sidebarOpen}
        collapsed={collapsed}
        onClose={() => setSidebarOpen(false)}
        onToggleCollapse={handleToggleCollapse}
      />

      <div className={`${collapsed ? "lg:pl-16" : "lg:pl-64"} flex flex-col min-h-screen transition-all duration-300`}>
        {/* Slim topbar — just menu toggle on mobile + identity strip on desktop */}
        <header className="sticky top-0 z-20 flex items-center h-12 bg-white border-b border-slate-200 px-4 lg:px-6">
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
          <span className="ml-auto text-xs text-slate-400">
            {me.user.email}
          </span>
        </header>

        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
