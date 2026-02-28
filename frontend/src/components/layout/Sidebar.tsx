"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HomeIcon,
  InboxIcon,
  BriefcaseIcon,
  UsersIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: HomeIcon },
  { label: "Inbox", href: "/inbox", icon: InboxIcon },
  { label: "Jobs", href: "/jobs", icon: BriefcaseIcon },
  { label: "Candidates", href: "/candidates", icon: UsersIcon },
  { label: "Reports", href: "/reports", icon: ChartBarIcon },
  { label: "Settings", href: "/settings", icon: Cog6ToothIcon },
];

interface SidebarProps {
  isOpen: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggleCollapse: () => void;
}

export default function Sidebar({ isOpen, collapsed, onClose, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string): boolean => {
    if (href === "/dashboard") {
      return pathname === "/dashboard";
    }
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 z-50 h-full bg-slate-900 flex flex-col
          transition-all duration-300 ease-in-out
          lg:z-30
          ${collapsed ? "lg:w-16" : "lg:w-64"}
          ${isOpen ? "translate-x-0 w-64" : "-translate-x-full lg:translate-x-0"}
        `}
      >
        {/* Logo area */}
        <div className={`flex items-center ${collapsed ? "justify-center px-2" : "gap-3 px-6"} py-5 border-b border-slate-800`}>
          <div className="flex items-center justify-center w-8 h-8 bg-blue-600 rounded-lg shrink-0">
            <BriefcaseIcon className="w-5 h-5 text-white" />
          </div>
          {!collapsed && (
            <span className="text-lg font-semibold text-white tracking-tight">
              HireOps AI
            </span>
          )}
        </div>

        {/* Navigation */}
        <nav className={`flex-1 ${collapsed ? "px-2" : "px-3"} py-4 space-y-1 overflow-y-auto`}>
          {navItems.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => onClose()}
                title={collapsed ? item.label : undefined}
                className={`
                  flex items-center ${collapsed ? "justify-center" : "gap-3"} ${collapsed ? "px-0 py-2.5" : "px-3 py-2.5"} rounded-lg text-sm font-medium
                  transition-colors duration-150
                  ${
                    active
                      ? `bg-slate-800 text-white ${collapsed ? "" : "border-l-4 border-blue-500 pl-2"}`
                      : "text-slate-400 hover:text-white hover:bg-slate-800/50"
                  }
                `}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Collapse toggle (desktop only) */}
        <div className={`hidden lg:block ${collapsed ? "px-2" : "px-3"} py-3 border-t border-slate-800`}>
          <button
            onClick={onToggleCollapse}
            className={`flex items-center ${collapsed ? "justify-center w-full" : "gap-3 w-full px-3"} py-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/50 transition-colors text-sm`}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRightIcon className="w-5 h-5" />
            ) : (
              <>
                <ChevronLeftIcon className="w-5 h-5 shrink-0" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>

        {/* Version */}
        {!collapsed && (
          <div className="px-6 py-4 border-t border-slate-800">
            <p className="text-xs text-slate-500">v1.0.0</p>
          </div>
        )}
      </aside>
    </>
  );
}
