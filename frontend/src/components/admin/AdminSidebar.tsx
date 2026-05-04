"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ShieldCheckIcon,
  BuildingOffice2Icon,
  ChartBarIcon,
  DocumentTextIcon,
  ArrowRightOnRectangleIcon,
  ArrowsRightLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import { useAdmin } from "./AdminGate";

const navItems = [
  { label: "Tenants", href: "/admin", icon: BuildingOffice2Icon, match: /^\/admin(\/tenants(\/.*)?)?$/ },
  { label: "Users", href: "/admin/users", icon: UsersIcon, match: /^\/admin\/users/ },
  { label: "Analytics", href: "/admin/analytics", icon: ChartBarIcon, match: /^\/admin\/analytics/ },
  { label: "Audit log", href: "/admin/audit-log", icon: DocumentTextIcon, match: /^\/admin\/audit-log/ },
];

interface AdminSidebarProps {
  isOpen: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggleCollapse: () => void;
}

export default function AdminSidebar({
  isOpen,
  collapsed,
  onClose,
  onToggleCollapse,
}: AdminSidebarProps) {
  const pathname = usePathname();
  const { me, logout } = useAdmin();

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 z-50 h-full bg-slate-950 text-slate-100 flex flex-col
          transition-all duration-300 ease-in-out
          lg:z-30 border-r border-slate-800
          ${collapsed ? "lg:w-16" : "lg:w-64"}
          ${isOpen ? "translate-x-0 w-64" : "-translate-x-full lg:translate-x-0"}
        `}
      >
        {/* Brand */}
        <div className={`flex items-center ${collapsed ? "justify-center px-2" : "gap-3 px-6"} py-5 border-b border-slate-800`}>
          <div className="flex items-center justify-center w-8 h-8 bg-indigo-600 rounded-lg shrink-0">
            <ShieldCheckIcon className="w-5 h-5 text-white" />
          </div>
          {!collapsed && (
            <div>
              <p className="text-sm font-semibold text-white tracking-tight leading-none">
                HireOps
              </p>
              <p className="text-[10px] uppercase tracking-wider text-indigo-400 mt-0.5">
                Platform Admin
              </p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className={`flex-1 ${collapsed ? "px-2" : "px-3"} py-4 space-y-1 overflow-y-auto`}>
          {navItems.map((item) => {
            const active = item.match.test(pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                title={collapsed ? item.label : undefined}
                className={`
                  flex items-center ${collapsed ? "justify-center" : "gap-3"} ${collapsed ? "px-0 py-2.5" : "px-3 py-2.5"} rounded-lg text-sm font-medium
                  transition-colors duration-150
                  ${active
                    ? `bg-slate-800 text-white ${collapsed ? "" : "border-l-4 border-indigo-500 pl-2"}`
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

        {/* Switch to my workspace */}
        <div className={`${collapsed ? "px-2" : "px-3"} py-3 border-t border-slate-800 space-y-1`}>
          <Link
            href="/dashboard"
            title={collapsed ? "View my workspace" : undefined}
            className={`flex items-center ${collapsed ? "justify-center" : "gap-3"} ${collapsed ? "px-0 py-2" : "px-3 py-2"} rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800/50 transition-colors`}
          >
            <ArrowsRightLeftIcon className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>View my workspace</span>}
          </Link>

          <button
            type="button"
            onClick={logout}
            title={collapsed ? "Sign out" : undefined}
            className={`flex w-full items-center ${collapsed ? "justify-center" : "gap-3"} ${collapsed ? "px-0 py-2" : "px-3 py-2"} rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800/50 transition-colors`}
          >
            <ArrowRightOnRectangleIcon className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>

        {/* User identity strip */}
        {!collapsed && (
          <div className="px-6 py-3 border-t border-slate-800">
            <p className="text-xs text-slate-500 truncate">{me.user.email}</p>
            <p className="text-[10px] text-slate-600 mt-0.5">superadmin · v1.0.0</p>
          </div>
        )}

        {/* Collapse toggle */}
        <div className={`hidden lg:block ${collapsed ? "px-2" : "px-3"} pb-3`}>
          <button
            onClick={onToggleCollapse}
            className={`flex items-center ${collapsed ? "justify-center w-full" : "gap-3 w-full px-3"} py-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800/50 transition-colors text-xs`}
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? (
              <ChevronRightIcon className="w-4 h-4" />
            ) : (
              <>
                <ChevronLeftIcon className="w-4 h-4 shrink-0" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
