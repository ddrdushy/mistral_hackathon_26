"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/outline";

import { apiGet } from "@/lib/api";
import type { AuditLogEntry } from "@/types/index";
import { timeAgo } from "@/lib/constants";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";

const ACTIONS = [
  "all",
  "tenant.suspend",
  "tenant.unsuspend",
  "tenant.impersonate",
  "tenant.edit",
  "tenant.delete",
  "tenant.restore",
] as const;

const ACTION_VARIANTS: Record<string, string> = {
  "tenant.suspend": "bg-red-50 text-red-700",
  "tenant.unsuspend": "bg-emerald-50 text-emerald-700",
  "tenant.impersonate": "bg-amber-50 text-amber-700",
  "tenant.edit": "bg-blue-50 text-blue-700",
  "tenant.delete": "bg-slate-200 text-slate-700",
  "tenant.restore": "bg-emerald-50 text-emerald-700",
};

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [actorEmail, setActorEmail] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 50;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {
        page: String(page),
        per_page: String(perPage),
      };
      if (actionFilter !== "all") params.action = actionFilter;
      if (actorEmail.trim()) params.actor_email = actorEmail.trim();
      const data = await apiGet<{ entries: AuditLogEntry[]; total: number }>(
        "/admin/audit-log",
        params,
      );
      setEntries(data.entries);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [actionFilter, actorEmail, page]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to tenants
        </Link>
        <div className="flex items-center gap-2 mb-1">
          <DocumentTextIcon className="h-5 w-5 text-indigo-600" />
          <h1 className="text-2xl font-semibold text-slate-900">Audit log</h1>
        </div>
        <p className="text-sm text-slate-500">
          Every privileged super-admin action, in order. Append-only.
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Action:</span>
          <div className="flex flex-wrap gap-1">
            {ACTIONS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => {
                  setPage(1);
                  setActionFilter(a);
                }}
                className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  actionFilter === a
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {a === "all" ? "All" : a.replace("tenant.", "")}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Actor:</span>
          <input
            type="text"
            placeholder="email contains..."
            value={actorEmail}
            onChange={(e) => {
              setPage(1);
              setActorEmail(e.target.value);
            }}
            className="flex-1 px-2.5 py-1 rounded-md border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      ) : error ? (
        <EmptyState icon={<DocumentTextIcon />} title="Failed to load" description={error} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<DocumentTextIcon />}
          title="No audit entries"
          description="Privileged actions will be recorded here."
        />
      ) : (
        <>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-xs uppercase tracking-wide text-slate-500">
                    <th className="text-left font-medium px-4 py-2.5">When</th>
                    <th className="text-left font-medium px-4 py-2.5">Actor</th>
                    <th className="text-left font-medium px-4 py-2.5">Action</th>
                    <th className="text-left font-medium px-4 py-2.5">Target tenant</th>
                    <th className="text-left font-medium px-4 py-2.5">IP</th>
                    <th className="text-left font-medium px-4 py-2.5">Payload</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                        {timeAgo(e.created_at)}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700 truncate max-w-[200px]">
                        {e.actor_email}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                            ACTION_VARIANTS[e.action_type] || "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {e.action_type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {e.target_tenant_id ? (
                          <Link
                            href={`/admin/tenants/${e.target_tenant_id}`}
                            className="text-indigo-600 hover:underline"
                          >
                            {e.target_tenant_name || `#${e.target_tenant_id}`}
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs font-mono text-slate-500">
                        {e.ip_address || "—"}
                      </td>
                      <td className="px-4 py-2.5 max-w-[400px]">
                        {Object.keys(e.payload).length > 0 ? (
                          <pre className="text-[10px] text-slate-600 bg-slate-50 px-2 py-1 rounded overflow-x-auto">
                            {JSON.stringify(e.payload, null, 0)}
                          </pre>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
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
                Page {page} of {totalPages} · {total} entries
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
