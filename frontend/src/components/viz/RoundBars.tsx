"use client";

import React from "react";

interface RoundBar {
  label: string;
  score: number | null;
  weight?: number; // 0-1, displayed as % suffix
}

/**
 * Compact horizontal-bar display for round-by-round scores. Used for Q&A
 * interview rounds (aptitude/reasoning/technical).
 */
export default function RoundBars({ rounds }: { rounds: RoundBar[] }) {
  return (
    <div className="space-y-2.5">
      {rounds.map((r) => {
        const v = r.score ?? 0;
        const color =
          v >= 75 ? "#10b981" : v >= 50 ? "#3b82f6" : v >= 30 ? "#f59e0b" : "#ef4444";
        return (
          <div key={r.label}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-slate-600">
                {r.label}
                {r.weight != null && (
                  <span className="ml-1 text-slate-400">
                    ({Math.round(r.weight * 100)}%)
                  </span>
                )}
              </span>
              <span
                className="font-bold tabular-nums"
                style={{ color: r.score == null ? "#94a3b8" : color }}
              >
                {r.score == null ? "—" : Math.round(r.score)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(0, Math.min(100, v))}%`,
                  background: color,
                  transition: "width 600ms ease-out",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
