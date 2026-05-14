"use client";

/**
 * AI spend widget for the dashboard.
 *
 * Pulls /billing/llm-trend and renders:
 *   - Month-to-date billable spend (large)
 *   - 30-day sparkline + today's number underneath
 *   - "View detailed report →" link to /settings/billing
 *
 * Billable = raw provider cost × tenant plan's markup multiplier, so
 * the number HR sees matches what we'd invoice.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChartBarIcon } from "@heroicons/react/24/outline";
import { apiGet } from "@/lib/api";

interface TrendPoint {
  date: string;
  calls: number;
  spent_usd: number;
}

interface TrendResponse {
  days: number;
  trend: TrendPoint[];
  month_to_date_usd: number;
  month_calls: number;
  markup_multiplier: number;
}

function formatUsd(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export default function AiSpendWidget() {
  const [data, setData] = useState<TrendResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiGet<TrendResponse>("/billing/llm-trend?days=30");
        if (!cancelled) setData(res);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !data) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 animate-pulse">
        <div className="h-3 w-24 bg-slate-200 rounded mb-3" />
        <div className="h-8 w-32 bg-slate-200 rounded mb-2" />
        <div className="h-2 w-full bg-slate-100 rounded" />
      </div>
    );
  }

  const today = data.trend[data.trend.length - 1];
  const max = Math.max(...data.trend.map((p) => p.spent_usd), 0.001);

  // SVG sparkline. Built off the trend array (oldest → newest), with
  // a baseline + a thin gradient fill so a flat-zero series still has
  // visible context.
  const w = 220;
  const h = 36;
  const pts = data.trend
    .map((p, i) => {
      const x = (i / Math.max(1, data.trend.length - 1)) * w;
      const y = h - (p.spent_usd / max) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            AI spend this month
          </p>
          <p className="text-3xl font-bold text-slate-900 tabular-nums mt-1">
            {formatUsd(data.month_to_date_usd)}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {data.month_calls.toLocaleString()} call
            {data.month_calls === 1 ? "" : "s"} ·{" "}
            billable cost at {data.markup_multiplier.toFixed(1)}× markup
          </p>
        </div>
        <ChartBarIcon className="w-5 h-5 text-indigo-500 flex-shrink-0" />
      </div>

      {/* Sparkline */}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="w-full h-9 mt-2"
        aria-hidden
      >
        <defs>
          <linearGradient id="aispend-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(99,102,241)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="rgb(99,102,241)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon
          fill="url(#aispend-grad)"
          points={`0,${h} ${pts} ${w},${h}`}
        />
        <polyline
          fill="none"
          stroke="rgb(99,102,241)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={pts}
        />
      </svg>

      <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500">
        <span>30-day trend</span>
        <span>
          Today: <span className="font-semibold text-slate-700">
            {today ? formatUsd(today.spent_usd) : "$0.00"}
          </span>
        </span>
      </div>
      <Link
        href="/settings/billing"
        className="inline-block mt-3 text-xs font-medium text-indigo-600 hover:text-indigo-800"
      >
        Detailed report →
      </Link>
    </div>
  );
}
