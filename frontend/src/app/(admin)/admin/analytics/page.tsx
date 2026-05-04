"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  ChartBarIcon,
  CurrencyDollarIcon,
  SparklesIcon,
  ExclamationTriangleIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";

import { apiGet } from "@/lib/api";
import type { AdminAnalytics } from "@/types/index";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import Card from "@/components/ui/Card";

const PLAN_COLORS: Record<string, string> = {
  free: "#94a3b8",
  starter: "#3b82f6",
  pro: "#8b5cf6",
};

export default function AnalyticsPage() {
  const [a, setA] = useState<AdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiGet<AdminAnalytics>("/admin/analytics");
      setA(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, []);

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

  if (error || !a) {
    return (
      <EmptyState
        icon={<ChartBarIcon />}
        title="Failed to load analytics"
        description={error || "—"}
      />
    );
  }

  const planChartData = Object.entries(a.plan_breakdown)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: k, value: v, color: PLAN_COLORS[k] || "#cbd5e1" }));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to tenants
        </Link>
        <div className="flex items-center gap-2 mb-1">
          <ChartBarIcon className="h-5 w-5 text-indigo-600" />
          <h1 className="text-2xl font-semibold text-slate-900">Analytics</h1>
        </div>
        <p className="text-sm text-slate-500">
          Platform-wide growth, revenue, and AI cost. Pulled live from the database.
        </p>
      </div>

      {/* ═══════════════════════════════════════ */}
      {/* GROWTH                                   */}
      {/* ═══════════════════════════════════════ */}
      <SectionHeading icon={<UsersIcon className="w-5 h-5" />} title="Growth" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Total tenants" value={a.tenants_total} />
        <Tile label="Active (28d)" value={a.tenants_active_28d} />
        <Tile label="Paid tenants" value={a.tenants_paid} />
        <Tile
          label="Free → paid"
          value={`${a.free_to_paid_conversion_pct}%`}
          tone={a.free_to_paid_conversion_pct >= 5 ? "good" : "neutral"}
        />
      </div>

      <Card title="Signups (last 30 days)">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={a.signups_per_day_30d}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#64748b" }}
                tickFormatter={(v) => v.slice(5)}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fontSize: 10, fill: "#64748b" }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
                formatter={(v) => [`${v ?? 0}`, "Signups"]}
              />
              <Bar dataKey="signups" fill="#4f46e5" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ═══════════════════════════════════════ */}
      {/* REVENUE                                  */}
      {/* ═══════════════════════════════════════ */}
      <SectionHeading icon={<CurrencyDollarIcon className="w-5 h-5" />} title="Revenue" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-1">
          <Card>
            <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">
              MRR
            </p>
            <p className="text-4xl font-bold text-slate-900">
              ${a.mrr_usd.toFixed(0)}
              <span className="text-base font-medium text-slate-500"> /mo</span>
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Sum of plan price × active subscriptions (active / trialing / past_due / manual).
            </p>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card title="Tenants by plan">
            {planChartData.length > 0 ? (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={planChartData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={45}
                      outerRadius={75}
                      paddingAngle={2}
                    >
                      {planChartData.map((d) => (
                        <Cell key={d.name} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Legend
                      verticalAlign="middle"
                      align="right"
                      layout="vertical"
                      iconType="circle"
                      wrapperStyle={{ fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-slate-400">No tenants yet.</p>
            )}
          </Card>
        </div>
      </div>

      {a.past_due.length > 0 && (
        <Card
          title={`Past-due subscriptions (${a.past_due.length})`}
          action={
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
              <ExclamationTriangleIcon className="w-3.5 h-3.5" />
              Action needed
            </span>
          }
        >
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100">
                <th className="text-left font-medium px-1 py-2">Tenant</th>
                <th className="text-left font-medium px-1 py-2">Plan</th>
                <th className="text-left font-medium px-1 py-2">Owner</th>
                <th className="text-left font-medium px-1 py-2">Period end</th>
              </tr>
            </thead>
            <tbody>
              {a.past_due.map((t) => (
                <tr key={t.tenant_id} className="border-b border-slate-50 last:border-0">
                  <td className="px-1 py-2">
                    <Link
                      href={`/admin/tenants/${t.tenant_id}`}
                      className="text-indigo-600 hover:underline font-medium"
                    >
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-1 py-2 capitalize">{t.plan}</td>
                  <td className="px-1 py-2 text-slate-600">{t.owner_email || "—"}</td>
                  <td className="px-1 py-2 text-xs text-slate-500">
                    {t.current_period_end
                      ? new Date(t.current_period_end).toLocaleDateString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* COSTS                                    */}
      {/* ═══════════════════════════════════════ */}
      <SectionHeading icon={<SparklesIcon className="w-5 h-5" />} title="AI cost" />

      <Card
        title="Total LLM spend (last 30 days)"
        action={
          <span className="text-xs font-semibold text-slate-700">
            ${a.llm_spend_total_30d_usd.toFixed(2)} total
          </span>
        }
      >
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={a.daily_llm_spend_30d}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#64748b" }}
                tickFormatter={(v) => v.slice(5)}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#64748b" }}
                tickFormatter={(v) => `$${v}`}
              />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
                formatter={(v) => [`$${Number(v ?? 0).toFixed(4)}`, "Spend"]}
              />
              <Bar dataKey="total_usd" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Top spenders (30d)">
          {a.top_spenders_30d.length === 0 ? (
            <p className="text-sm text-slate-400">No spend yet.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100">
                  <th className="text-left font-medium px-1 py-1.5 w-6">#</th>
                  <th className="text-left font-medium px-1 py-1.5">Tenant</th>
                  <th className="text-right font-medium px-1 py-1.5">Calls</th>
                  <th className="text-right font-medium px-1 py-1.5">Spend</th>
                </tr>
              </thead>
              <tbody>
                {a.top_spenders_30d.map((s, i) => (
                  <tr key={s.tenant_id} className="border-b border-slate-50 last:border-0">
                    <td className="px-1 py-1.5 text-slate-400 font-medium">{i + 1}</td>
                    <td className="px-1 py-1.5">
                      <Link
                        href={`/admin/tenants/${s.tenant_id}`}
                        className="text-slate-900 hover:text-indigo-600"
                      >
                        {s.tenant_name}
                      </Link>
                      <span className="ml-1.5 text-[10px] uppercase tracking-wider text-slate-400">
                        {s.plan}
                      </span>
                    </td>
                    <td className="px-1 py-1.5 text-right tabular-nums text-slate-600">
                      {s.calls}
                    </td>
                    <td className="px-1 py-1.5 text-right tabular-nums font-semibold text-slate-900">
                      ${s.total_usd.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Spend by agent (30d)">
          {a.per_agent_breakdown_30d.length === 0 ? (
            <p className="text-sm text-slate-400">No spend yet.</p>
          ) : (
            <div className="space-y-2">
              {a.per_agent_breakdown_30d.map((row) => {
                const max = Math.max(...a.per_agent_breakdown_30d.map((r) => r.total_usd));
                const pct = max > 0 ? Math.round((row.total_usd / max) * 100) : 0;
                return (
                  <div key={row.agent_name}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium text-slate-700 truncate">{row.agent_name}</span>
                      <span className="font-semibold tabular-nums text-slate-900">
                        ${row.total_usd.toFixed(2)}
                        <span className="ml-1.5 text-slate-400 font-normal">{row.calls} calls</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-violet-500"
                        style={{ width: `${pct}%`, transition: "width 600ms ease-out" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function SectionHeading({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <span className="text-indigo-600">{icon}</span>
      <h2 className="text-base font-semibold text-slate-700 uppercase tracking-wider">
        {title}
      </h2>
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "good" | "warn" | "neutral";
}) {
  const valueColor =
    tone === "good"
      ? "text-emerald-600"
      : tone === "warn"
        ? "text-amber-600"
        : "text-slate-900";
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${valueColor}`}>{value}</p>
    </div>
  );
}
