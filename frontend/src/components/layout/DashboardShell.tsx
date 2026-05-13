"use client";

import { useState, useCallback, useEffect } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import OnboardingTour from "@/components/tour/OnboardingTour";
import VerificationBanner from "@/components/auth/VerificationBanner";
import OrganizationProfileBanner from "@/components/auth/OrganizationProfileBanner";
import { HelpProvider } from "@/components/help/HelpContext";
import FloatingHelpButton from "@/components/help/FloatingHelpButton";
import CommandPalette from "./CommandPalette";

interface DashboardShellProps {
  children: React.ReactNode;
}

export default function DashboardShell({ children }: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Persist collapse state in localStorage
  useEffect(() => {
    const stored = localStorage.getItem("sidebar-collapsed");
    if (stored === "true") setCollapsed(true);
  }, []);

  const handleMenuToggle = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const handleSidebarClose = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  const handleToggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  }, []);

  return (
    <HelpProvider>
      <div className="min-h-screen bg-slate-50">
        {/* Sidebar */}
        <Sidebar
          isOpen={sidebarOpen}
          collapsed={collapsed}
          onClose={handleSidebarClose}
          onToggleCollapse={handleToggleCollapse}
        />

        {/* Main area offset by sidebar width on desktop */}
        <div className={`${collapsed ? "lg:pl-16" : "lg:pl-64"} flex flex-col min-h-screen transition-all duration-300`}>
          {/* Topbar */}
          <Topbar onMenuToggle={handleMenuToggle} />

          {/* Main content */}
          <main className="flex-1 overflow-auto p-6">
            <VerificationBanner />
            <OrganizationProfileBanner />
            {children}
          </main>
        </div>

        {/* Guided tour for first-time users */}
        <OnboardingTour />

        {/* Always-visible help launcher (bottom-right). Triggers the
            same drawer as the Topbar ? icon via HelpContext, but is
            far more discoverable for new users who don't scan the
            top-right corner. */}
        <FloatingHelpButton />

        {/* Global Cmd-K / Ctrl-K command palette — search candidates,
            navigate, run actions. Mounted once at the shell so it's
            available on every dashboard route. */}
        <CommandPalette />
      </div>
    </HelpProvider>
  );
}
