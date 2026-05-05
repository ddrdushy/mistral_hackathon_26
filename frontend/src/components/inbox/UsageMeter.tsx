"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

export interface InboxUsage {
  emails: { today: number; month: number };
  classified: { today: number; month: number };
  candidates_created_month: number;
  classifier_llm: {
    today: { cost_usd: number; tokens: number; calls: number };
    month: { cost_usd: number; tokens: number; calls: number };
  };
  llm_budget_today: { spent_usd: number; budget_usd: number; remaining_usd: number };
  as_of: string;
}

interface Props {
  refreshKey?: number;
  className?: string;
}

const fmtMoney = (n: number) => {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
};

const fmtTokens = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

export default function UsageMeter({ refreshKey, className = "" }: Props) {
  const [usage, setUsage] = useState<InboxUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = useCallback(async () => {
    try {
      const data = await apiGet<InboxUsage>("/inbox/usage");
      setUsage(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load usage");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsage();
    const t = setInterval(fetchUsage, 30_000);
    return () => clearInterval(t);
  }, [fetchUsage, refreshKey]);

  const budget = usage?.llm_budget_today.budget_usd ?? 0;
  const spent = usage?.llm_budget_today.spent_usd ?? 0;
  const unlimited = budget < 0;
  const pct = unlimited
    ? 0
    : budget > 0
    ? Math.min(100, Math.round((spent / budget) * 100))
    : 0;
  const barColor =
    pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";

  const classifierToday = usage?.classifier_llm.today;
  const classifierMonth = usage?.classifier_llm.month;
  const emailsToday = usage?.emails.today ?? 0;
  const emailsMonth = usage?.emails.month ?? 0;
  const classifiedToday = usage?.classified.today ?? 0;
  const classifiedMonth = usage?.classified.month ?? 0;
  const classifyRate =
    emailsMonth > 0 ? Math.round((classifiedMonth / emailsMonth) * 100) : 0;

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6 ${className}`}>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            Usage Meters
            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">
              Tenant
            </span>
          </h2>
          <p className="text-sm text-slate-500">
            Inbox volume and Mistral classifier spend — refreshes every 30s.
          </p>
        </div>
        <button
          onClick={() => {
            setLoading(true);
            fetchUsage();
          }}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <svg className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <MetricTile
          label="Emails Today"
          value={loading && !usage ? "…" : emailsToday.toLocaleString()}
          sub={`${emailsMonth.toLocaleString()} this month`}
          accent="indigo"
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z" />
            </svg>
          }
        />
        <MetricTile
          label="Classified Today"
          value={loading && !usage ? "…" : classifiedToday.toLocaleString()}
          sub={`${classifyRate}% rate this month`}
          accent="violet"
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9l2 2 4-4" />
            </svg>
          }
        />
        <MetricTile
          label="Classifier Cost Today"
          value={loading && !usage ? "…" : fmtMoney(classifierToday?.cost_usd ?? 0)}
          sub={`${classifierToday?.calls ?? 0} calls · ${fmtTokens(classifierToday?.tokens ?? 0)} tokens`}
          accent="emerald"
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
            </svg>
          }
        />
        <MetricTile
          label="Cost This Month"
          value={loading && !usage ? "…" : fmtMoney(classifierMonth?.cost_usd ?? 0)}
          sub={`${classifierMonth?.calls ?? 0} classifier calls`}
          accent="amber"
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2zm0 0V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v10m-6 0a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2m0 0V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z" />
            </svg>
          }
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-slate-700">Daily LLM Budget</div>
          <div className="text-xs text-slate-500">
            {unlimited ? (
              <span className="text-emerald-600 font-medium">Unlimited (Pro)</span>
            ) : (
              <>
                <span className="font-semibold text-slate-900">{fmtMoney(spent)}</span>
                <span className="text-slate-400"> / {fmtMoney(budget)}</span>
              </>
            )}
          </div>
        </div>
        {!unlimited && (
          <>
            <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
              <div
                className={`h-full ${barColor} transition-all duration-500`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500">
              <span>
                {pct}% used today
                {pct >= 90 && (
                  <span className="ml-1.5 text-red-600 font-medium">· near cap</span>
                )}
              </span>
              <span>
                {fmtMoney(usage?.llm_budget_today.remaining_usd ?? 0)} remaining
              </span>
            </div>
          </>
        )}
        {unlimited && (
          <div className="text-xs text-slate-500">
            Today&apos;s spend: <span className="font-semibold text-slate-900">{fmtMoney(spent)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

const ACCENTS: Record<string, { bg: string; text: string; ring: string }> = {
  indigo: { bg: "bg-indigo-50", text: "text-indigo-700", ring: "ring-indigo-100" },
  violet: { bg: "bg-violet-50", text: "text-violet-700", ring: "ring-violet-100" },
  emerald: { bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-100" },
  amber: { bg: "bg-amber-50", text: "text-amber-700", ring: "ring-amber-100" },
};

function MetricTile({
  label,
  value,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  accent: keyof typeof ACCENTS;
  icon: React.ReactNode;
}) {
  const a = ACCENTS[accent];
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
          {label}
        </div>
        <div className={`w-7 h-7 rounded-md ${a.bg} ${a.text} flex items-center justify-center ring-1 ${a.ring}`}>
          {icon}
        </div>
      </div>
      <div className="text-xl font-semibold text-slate-900 tabular-nums">{value}</div>
      <div className="text-[11px] text-slate-500 mt-0.5 truncate">{sub}</div>
    </div>
  );
}
