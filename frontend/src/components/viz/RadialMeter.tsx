"use client";

import React from "react";

/**
 * Half-circle "speedometer" gauge for risk metrics. Lower is better.
 * Reverses the colour band of ScoreGauge (low value = green, high = red).
 */
interface RadialMeterProps {
  value: number | null | undefined;
  max?: number;
  label?: string;
  /** Use "risk" semantics (low=green, high=red) or "score" (low=red, high=green). */
  semantic?: "risk" | "score";
  size?: number;
}

function colorRisk(v: number) {
  if (v <= 25) return "#10b981"; // emerald
  if (v <= 50) return "#f59e0b"; // amber
  return "#ef4444"; // red
}
function colorScore(v: number) {
  if (v >= 75) return "#10b981";
  if (v >= 50) return "#f59e0b";
  return "#ef4444";
}

export default function RadialMeter({
  value,
  max = 100,
  label,
  semantic = "risk",
  size = 140,
}: RadialMeterProps) {
  const v = typeof value === "number" && !Number.isNaN(value) ? value : 0;
  const pct = Math.max(0, Math.min(1, v / max));
  const stroke = 12;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2 + r / 4;
  // Half-circle path (arc from 180° → 0°)
  const trackPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  // Half-circle length = π·r
  const len = Math.PI * r;
  const dash = len * pct;
  const arcColor = semantic === "risk" ? colorRisk(v) : colorScore(v);

  const labelText =
    semantic === "risk"
      ? v <= 25
        ? "Low"
        : v <= 50
          ? "Medium"
          : "High"
      : v >= 75
        ? "Strong"
        : v >= 50
          ? "OK"
          : "Weak";

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size / 2 + 8 }}>
        <svg width={size} height={size / 2 + 8}>
          <path
            d={trackPath}
            stroke="#e2e8f0"
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
          />
          <path
            d={trackPath}
            stroke={arcColor}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${len - dash}`}
            style={{ transition: "stroke-dasharray 600ms ease-out" }}
          />
        </svg>
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
          <span
            className="text-2xl font-bold tabular-nums"
            style={{ color: arcColor }}
          >
            {value == null ? "—" : Math.round(v)}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            {labelText}
          </span>
        </div>
      </div>
      {label && (
        <p className="mt-1 text-xs font-semibold text-slate-600 uppercase tracking-wider">
          {label}
        </p>
      )}
    </div>
  );
}
