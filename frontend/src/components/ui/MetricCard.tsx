"use client";

import React from "react";
import {
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
} from "@heroicons/react/24/outline";

type Trend = "up" | "down" | "neutral";

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: string;
  icon: React.ReactNode;
  trend?: Trend;
}

const trendConfig: Record<Trend, { color: string; bgColor: string }> = {
  up: { color: "text-emerald-600", bgColor: "bg-emerald-50" },
  down: { color: "text-red-600", bgColor: "bg-red-50" },
  neutral: { color: "text-slate-500", bgColor: "bg-slate-50" },
};

export default function MetricCard({
  title,
  value,
  change,
  icon,
  trend = "neutral",
}: MetricCardProps) {
  const { color, bgColor } = trendConfig[trend];

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 p-3 bg-blue-50 text-blue-600 rounded-lg">
          <div className="h-6 w-6">{icon}</div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-500 truncate">{title}</p>
          <div className="flex items-baseline gap-2 mt-1">
            <p className="text-2xl font-bold text-slate-900 tracking-tight">
              {value}
            </p>
            {change && (
              <span
                className={`inline-flex items-center gap-0.5 text-sm font-medium ${color}`}
              >
                {trend === "up" && (
                  <ArrowTrendingUpIcon className="h-4 w-4" />
                )}
                {trend === "down" && (
                  <ArrowTrendingDownIcon className="h-4 w-4" />
                )}
                {change}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
