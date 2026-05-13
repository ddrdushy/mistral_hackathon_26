"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  UsersIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  NoSymbolIcon,
} from "@heroicons/react/24/outline";

import { apiGet } from "@/lib/api";
import type { AdminUserItem } from "@/types/index";
import { timeAgo } from "@/lib/constants";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";

type RoleFilter = "all" | "owner" | "member" | "superadmin";

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [page, setPage] = useState(1);
  const perPage = 50;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {
        page: String(page),
        per_page: String(perPage),
      };
      if (search.trim()) params.search = search.trim();
      if (roleFilter !== "all") params.role = roleFilter;
      const data = await apiGet<{ users: AdminUserItem[]; total: number }>(
        "/admin/users",
        params,
      );
      setUsers(data.users);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, page]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 mb-1">Users</h1>
        <p className="text-sm text-slate-500">
          Tenant recruiters by default — platform superadmins are hidden unless you
          select the <span className="font-semibold text-slate-700">Superadmin</span> filter below.
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by email or name..."
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            className="w-full pl-9 pr-3 py-1.5 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            Role:
          </span>
          <div className="flex gap-1">
            {(["all", "owner", "member", "superadmin"] as RoleFilter[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setPage(1);
                  setRoleFilter(r);
                }}
                className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  roleFilter === r
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {r === "all"
                  ? "Tenant users"
                  : r === "superadmin"
                  ? "Superadmin"
                  : r.charAt(0).toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      ) : error ? (
        <EmptyState icon={<UsersIcon />} title="Failed to load" description={error} />
      ) : users.length === 0 ? (
        <EmptyState
          icon={<UsersIcon />}
          title="No users match"
          description="Try a different search or role filter."
        />
      ) : (
        <>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-xs uppercase tracking-wide text-slate-500">
                    <th className="text-left font-medium px-4 py-2.5">User</th>
                    <th className="text-left font-medium px-4 py-2.5">Tenant</th>
                    <th className="text-left font-medium px-4 py-2.5">Role</th>
                    <th className="text-left font-medium px-4 py-2.5">Last login</th>
                    <th className="text-left font-medium px-4 py-2.5">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      className={`border-b border-slate-100 last:border-0 ${
                        u.disabled ? "bg-slate-100/60 opacity-70" : "hover:bg-slate-50"
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/admin/users/${u.id}`}
                          className="font-medium text-slate-900 hover:text-indigo-600"
                        >
                          {u.name || u.email.split("@")[0]}
                        </Link>
                        <p className="text-xs text-slate-500 truncate max-w-[260px]">
                          {u.email}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          {u.is_superadmin && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700">
                              <ShieldCheckIcon className="w-2.5 h-2.5" />
                              superadmin
                            </span>
                          )}
                          {!u.email_verified && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700">
                              unverified
                            </span>
                          )}
                          {u.disabled && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">
                              <NoSymbolIcon className="w-2.5 h-2.5" />
                              disabled
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/admin/tenants/${u.tenant_id}`}
                          className="text-indigo-600 hover:underline text-sm"
                        >
                          {u.tenant_name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${
                            u.role === "owner"
                              ? "bg-indigo-50 text-indigo-700"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">
                        {u.last_login_at ? timeAgo(u.last_login_at) : "never"}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">
                        {timeAgo(u.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-slate-600">
              <span>
                Page {page} of {totalPages} · {total} users
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                  className="px-3 py-1 rounded-md text-xs font-medium bg-slate-100 hover:bg-slate-200 disabled:opacity-50"
                >
                  ← Previous
                </button>
                <button
                  type="button"
                  disabled={page === totalPages}
                  onClick={() => setPage(page + 1)}
                  className="px-3 py-1 rounded-md text-xs font-medium bg-slate-100 hover:bg-slate-200 disabled:opacity-50"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
