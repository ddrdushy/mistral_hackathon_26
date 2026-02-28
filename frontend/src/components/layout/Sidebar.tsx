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
  onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
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
          fixed top-0 left-0 z-50 h-full w-64 bg-slate-900 flex flex-col
          transition-transform duration-300 ease-in-out
          lg:translate-x-0 lg:z-30
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Logo area */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-800">
          <div className="flex items-center justify-center w-8 h-8 bg-blue-600 rounded-lg">
            <BriefcaseIcon className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-semibold text-white tracking-tight">
            HireOps AI
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => onClose()}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                  transition-colors duration-150
                  ${
                    active
                      ? "bg-slate-800 text-white border-l-4 border-blue-500 pl-2"
                      : "text-slate-400 hover:text-white hover:bg-slate-800/50"
                  }
                `}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Version */}
        <div className="px-6 py-4 border-t border-slate-800">
          <p className="text-xs text-slate-500">v1.0.0</p>
        </div>
      </aside>
    </>
  );
}
