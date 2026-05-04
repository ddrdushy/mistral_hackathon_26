"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  ArrowsRightLeftIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  TrashIcon,
  ArrowUturnLeftIcon,
  PencilSquareIcon,
  UsersIcon,
  ShieldCheckIcon,
  ArrowDownTrayIcon,
  FireIcon,
} from "@heroicons/react/24/outline";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import type { AdminTenantDetail, PlanName } from "@/types/index";
import { timeAgo } from "@/lib/constants";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

export default function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [t, setT] = useState<AdminTenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  // Edit form state
  const [editing, setEditing] = useState(false);
  const [editPlan, setEditPlan] = useState<PlanName>("free");
  const [editName, setEditName] = useState("");
  const [editJobs, setEditJobs] = useState<string>("");
  const [editCands, setEditCands] = useState<string>("");
  const [editIvs, setEditIvs] = useState<string>("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiGet<AdminTenantDetail>(`/admin/tenants/${id}`);
      setT(data);
      setEditPlan(data.plan);
      setEditName(data.name);
      setEditJobs(data.max_jobs_override?.toString() ?? "");
      setEditCands(data.max_candidates_override?.toString() ?? "");
      setEditIvs(data.max_interviews_per_month_override?.toString() ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tenant");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error || !t) {
    return (
      <EmptyState
        icon={<ShieldCheckIcon />}
        title="Failed to load tenant"
        description={error || "Not found"}
      />
    );
  }

  const handleSuspend = async (suspended: boolean) => {
    setPending("suspend");
    try {
      await apiPost(`/admin/tenants/${t.id}/suspend`, { suspended });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setPending(null);
    }
  };

  const handleImpersonate = async () => {
    if (!confirm(`Login as ${t.name}? Your superadmin session will be replaced.`)) return;
    setPending("impersonate");
    try {
      await apiPost(`/admin/tenants/${t.id}/impersonate`);
      window.location.href = "/dashboard";
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
      setPending(null);
    }
  };

  const handleDelete = async () => {
    if (
      !confirm(
        `Soft-delete ${t.name}? They lose access immediately. The tenant can be restored within 30 days; after that all data is purged.`,
      )
    )
      return;
    setPending("delete");
    try {
      await apiDelete(`/admin/tenants/${t.id}`);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setPending(null);
    }
  };

  const handleRestore = async () => {
    setPending("restore");
    try {
      await apiPost(`/admin/tenants/${t.id}/restore`);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setPending(null);
    }
  };

  const handleExport = () => {
    // Direct browser download — credentials: include is set by api.ts but
    // for streaming downloads we just navigate the browser to the endpoint.
    const apiBase = process.env.NEXT_PUBLIC_API_URL || "https://hireops.symprio.com/api/v1";
    window.location.href = `${apiBase}/admin/tenants/${t.id}/export`;
  };

  const handleHardDelete = async () => {
    if (!t.deleted_at) {
      alert("Soft-delete first. Hard-delete is only available 30 days after soft-delete.");
      return;
    }
    const ageDays = Math.floor(
      (Date.now() - new Date(t.deleted_at).getTime()) / (1000 * 60 * 60 * 24),
    );
    const askConfirm = ageDays < 30;
    const msg = askConfirm
      ? `Soft-deleted only ${ageDays} days ago — normally we wait 30 days. Hard-delete anyway? This permanently removes ALL data and cannot be undone.`
      : `Permanently delete ${t.name} and ALL their data? This cannot be undone.`;
    if (!confirm(msg)) return;
    if (!confirm(`FINAL CHECK — type-confirm by clicking OK to permanently delete "${t.name}".`)) return;

    setPending("hard-delete");
    try {
      await apiDelete(`/admin/tenants/${t.id}/hard-delete${askConfirm ? "?confirm=true" : ""}`);
      // Tenant no longer exists — bounce to the list
      window.location.href = "/admin";
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
      setPending(null);
    }
  };

  const handleSaveEdit = async () => {
    setPending("edit");
    try {
      const intOrNull = (s: string): number | null => {
        const v = s.trim();
        if (v === "") return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      await apiPatch(`/admin/tenants/${t.id}`, {
        plan: editPlan,
        name: editName.trim() || undefined,
        max_jobs: intOrNull(editJobs) ?? -1,
        max_candidates: intOrNull(editCands) ?? -1,
        max_interviews_per_month: intOrNull(editIvs) ?? -1,
      });
      setEditing(false);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setPending(null);
    }
  };

  const isDeleted = !!t.deleted_at;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to tenants
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-slate-900">{t.name}</h1>
              <span className="text-xs font-mono text-slate-400">/t/{t.slug}</span>
              {isDeleted && (
                <Badge variant="danger" size="sm">
                  Deleted {timeAgo(t.deleted_at!)}
                </Badge>
              )}
              {t.suspended && !isDeleted && (
                <Badge variant="warning" size="sm">Suspended</Badge>
              )}
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase ${
                  t.plan === "pro"
                    ? "bg-violet-100 text-violet-700"
                    : t.plan === "starter"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-slate-100 text-slate-600"
                }`}
              >
                {t.plan}
              </span>
            </div>
            <p className="text-sm text-slate-500">
              Owner {t.owner_email || "—"} · created {timeAgo(t.created_at)}
              {t.last_activity_at && ` · last active ${timeAgo(t.last_activity_at)}`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isDeleted && (
              <>
                <button
                  type="button"
                  onClick={handleImpersonate}
                  disabled={pending !== null || t.suspended}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50"
                >
                  <ArrowsRightLeftIcon className="w-3.5 h-3.5" />
                  Login as
                </button>
                <button
                  type="button"
                  onClick={() => handleSuspend(!t.suspended)}
                  disabled={pending !== null}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold ${
                    t.suspended
                      ? "text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                      : "text-amber-700 bg-amber-50 hover:bg-amber-100"
                  } disabled:opacity-50`}
                >
                  {t.suspended ? <PlayCircleIcon className="w-3.5 h-3.5" /> : <PauseCircleIcon className="w-3.5 h-3.5" />}
                  {t.suspended ? "Reactivate" : "Suspend"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(!editing)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200"
                >
                  <PencilSquareIcon className="w-3.5 h-3.5" />
                  {editing ? "Cancel edit" : "Edit"}
                </button>
                <button
                  type="button"
                  onClick={handleExport}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200"
                  title="Download every row tagged with this tenant_id as JSON"
                >
                  <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                  Export data
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={pending !== null}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                  Delete
                </button>
              </>
            )}
            {isDeleted && (
              <>
                <button
                  type="button"
                  onClick={handleRestore}
                  disabled={pending !== null}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50"
                >
                  <ArrowUturnLeftIcon className="w-3.5 h-3.5" />
                  Restore
                </button>
                <button
                  type="button"
                  onClick={handleExport}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200"
                >
                  <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                  Export data
                </button>
                <button
                  type="button"
                  onClick={handleHardDelete}
                  disabled={pending !== null}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                  title="Permanently delete after 30-day window"
                >
                  <FireIcon className="w-3.5 h-3.5" />
                  Hard delete
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Edit panel */}
      {editing && (
        <Card title="Edit tenant">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Plan</label>
              <select
                value={editPlan}
                onChange={(e) => setEditPlan(e.target.value as PlanName)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm bg-white"
              >
                <option value="free">Free</option>
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Max jobs override (blank = use plan default)
              </label>
              <input
                value={editJobs}
                onChange={(e) => setEditJobs(e.target.value)}
                placeholder="(blank)"
                className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Max candidates override
              </label>
              <input
                value={editCands}
                onChange={(e) => setEditCands(e.target.value)}
                placeholder="(blank)"
                className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Max interviews / month override
              </label>
              <input
                value={editIvs}
                onChange={(e) => setEditIvs(e.target.value)}
                placeholder="(blank)"
                className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-3 py-1.5 rounded-md text-sm text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={pending !== null}
              className="px-3 py-1.5 rounded-md text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </Card>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Members" value={t.member_count} icon={<UsersIcon className="w-5 h-5" />} />
        <StatTile label="Jobs" value={t.job_count} />
        <StatTile label="Candidates" value={t.candidate_count} />
        <StatTile label="Interviews" value={t.interview_count} />
      </div>

      {/* LLM spend chart + Stripe state */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <Card title="LLM spend (last 30 days)" action={
            <span className="text-xs font-semibold text-slate-700">
              ${t.llm_spend_total_30d_usd.toFixed(2)} total
            </span>
          }>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={t.llm_spend_30d}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    tickFormatter={(v) => v.slice(5)}  // MM-DD
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
                    formatter={(v) => [`$${Number(v ?? 0).toFixed(4)}`, "Spend"]}
                  />
                  <Bar dataKey="total_usd" fill="#4f46e5" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        <Card title="Subscription">
          <div className="space-y-2 text-sm">
            <Row label="Plan" value={t.plan} />
            <Row label="Status" value={t.subscription_status || "—"} />
            <Row
              label="Period end"
              value={t.current_period_end ? new Date(t.current_period_end).toLocaleDateString() : "—"}
            />
            <Row
              label="Stripe customer"
              value={t.stripe_customer_id ? <span className="font-mono text-[10px]">{t.stripe_customer_id}</span> : "—"}
            />
            <Row
              label="Stripe subscription"
              value={t.stripe_subscription_id ? <span className="font-mono text-[10px]">{t.stripe_subscription_id}</span> : "—"}
            />
          </div>
        </Card>
      </div>

      {/* Members */}
      <Card title={`Members (${t.members.length})`}>
        <div className="overflow-x-auto -mx-6">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <th className="text-left font-medium px-6 py-2">Name</th>
                <th className="text-left font-medium px-6 py-2">Email</th>
                <th className="text-left font-medium px-6 py-2">Role</th>
                <th className="text-left font-medium px-6 py-2">Last active</th>
              </tr>
            </thead>
            <tbody>
              {t.members.map((m) => (
                <tr key={m.id} className="border-t border-slate-100">
                  <td className="px-6 py-2">{m.name || "—"}</td>
                  <td className="px-6 py-2">
                    {m.email}
                    {!m.email_verified && (
                      <span className="ml-2 text-[10px] text-amber-600">unverified</span>
                    )}
                  </td>
                  <td className="px-6 py-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${
                      m.role === "owner" ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-700"
                    }`}>
                      {m.role}
                    </span>
                  </td>
                  <td className="px-6 py-2 text-slate-500 text-xs">
                    {m.last_login_at ? timeAgo(m.last_login_at) : "never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function StatTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
      {icon && (
        <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
          {icon}
        </div>
      )}
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">{label}</p>
        <p className="text-xl font-bold text-slate-900 tabular-nums">{value}</p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs uppercase tracking-wide text-slate-500 font-semibold">{label}</span>
      <span className="text-slate-700 truncate max-w-[60%]">{value}</span>
    </div>
  );
}
