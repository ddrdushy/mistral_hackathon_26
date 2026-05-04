"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldCheckIcon,
  BriefcaseIcon,
  UsersIcon,
  PhoneIcon,
  ArrowsRightLeftIcon,
  PauseCircleIcon,
  PlayCircleIcon,
} from "@heroicons/react/24/outline";

import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthGate";
import type { AdminTenantSummary } from "@/types/index";
import { timeAgo } from "@/lib/constants";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";

export default function AdminPage() {
  const { me } = useAuth();
  const [tenants, setTenants] = useState<AdminTenantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiGet<{ tenants: AdminTenantSummary[] }>("/admin/tenants");
      setTenants(data.tenants);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tenants");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!me?.user.is_superadmin) {
    return (
      <EmptyState
        icon={<ShieldCheckIcon />}
        title="Superadmin only"
        description="This page is restricted to the Symprio team."
      />
    );
  }

  const handleSuspend = async (t: AdminTenantSummary) => {
    setPendingId(t.id);
    try {
      await apiPost(`/admin/tenants/${t.id}/suspend`, { suspended: !t.suspended });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setPendingId(null);
    }
  };

  const handleImpersonate = async (t: AdminTenantSummary) => {
    if (
      !confirm(
        `Impersonate ${t.name}? Your superadmin session will be replaced with the tenant owner's session. You'll need to sign back in afterwards.`,
      )
    )
      return;
    setPendingId(t.id);
    try {
      await apiPost(`/admin/tenants/${t.id}/impersonate`);
      window.location.href = "/dashboard";
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
      setPendingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState icon={<ShieldCheckIcon />} title="Failed to load" description={error} />
    );
  }

  const totalCandidates = tenants.reduce((s, t) => s + t.candidate_count, 0);
  const totalApps = tenants.reduce((s, t) => s + t.application_count, 0);
  const totalInterviews = tenants.reduce((s, t) => s + t.interview_count, 0);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheckIcon className="h-5 w-5 text-indigo-600" />
          <h1 className="text-2xl font-semibold text-slate-900">Admin</h1>
        </div>
        <p className="text-sm text-slate-500">
          All tenants on the platform. Suspend, impersonate, and inspect usage.
        </p>
      </div>

      {/* Global stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Tenants" value={tenants.length} icon={<BriefcaseIcon className="w-5 h-5" />} />
        <StatTile label="Candidates" value={totalCandidates} icon={<UsersIcon className="w-5 h-5" />} />
        <StatTile label="Applications" value={totalApps} icon={<UsersIcon className="w-5 h-5" />} />
        <StatTile label="Interviews" value={totalInterviews} icon={<PhoneIcon className="w-5 h-5" />} />
      </div>

      {/* Tenants table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="text-left font-medium px-4 py-3">Tenant</th>
                <th className="text-left font-medium px-4 py-3">Owner</th>
                <th className="text-left font-medium px-4 py-3">Plan</th>
                <th className="text-right font-medium px-4 py-3">Members</th>
                <th className="text-right font-medium px-4 py-3">Candidates</th>
                <th className="text-right font-medium px-4 py-3">Apps</th>
                <th className="text-right font-medium px-4 py-3">Interviews</th>
                <th className="text-left font-medium px-4 py-3">Last activity</th>
                <th className="text-right font-medium px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr
                  key={t.id}
                  className={`border-b border-slate-100 last:border-0 ${
                    t.suspended ? "bg-red-50/50" : "hover:bg-slate-50"
                  }`}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/tenants/${t.id}`}
                      className="font-medium text-slate-900 hover:text-indigo-600"
                    >
                      {t.name}
                    </Link>
                    <p className="text-xs text-slate-400 font-mono">/t/{t.slug}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600 truncate max-w-[200px]">
                    {t.owner_email || "—"}
                  </td>
                  <td className="px-4 py-3">
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
                    {t.suspended && (
                      <span className="ml-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                        suspended
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {t.member_count}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {t.candidate_count}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {t.application_count}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {t.interview_count}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {t.last_activity_at ? timeAgo(t.last_activity_at) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleImpersonate(t)}
                        disabled={pendingId === t.id || t.suspended}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Impersonate this tenant's owner"
                      >
                        <ArrowsRightLeftIcon className="w-3.5 h-3.5" />
                        Login as
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSuspend(t)}
                        disabled={pendingId === t.id}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium disabled:opacity-50 ${
                          t.suspended
                            ? "text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                            : "text-red-700 bg-red-50 hover:bg-red-100"
                        }`}
                      >
                        {t.suspended ? (
                          <>
                            <PlayCircleIcon className="w-3.5 h-3.5" />
                            Reactivate
                          </>
                        ) : (
                          <>
                            <PauseCircleIcon className="w-3.5 h-3.5" />
                            Suspend
                          </>
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
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
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
          {label}
        </p>
        <p className="text-xl font-bold text-slate-900 tabular-nums">{value}</p>
      </div>
    </div>
  );
}
