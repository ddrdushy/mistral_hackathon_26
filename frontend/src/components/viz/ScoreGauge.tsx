"use client";

import React from "react";

/**
 * Circular score gauge (0-100). Pure SVG, no deps.
 *
 * Renders a track + arc that fills based on `value`, color-coded by score band
 * (or override via `color`). Optionally shows a threshold tick mark.
 */
interface ScoreGaugeProps {
  value: number | null | undefined;
  max?: number;
  threshold?: number;
  label?: string;
  sublabel?: string;
  size?: number;
  /** Override the auto color. */
  color?: string;
  /** Show a small ring of the threshold marker. Default true if threshold given. */
  showThreshold?: boolean;
}

function bandColor(v: number) {
  if (v >= 80) return "#10b981"; // emerald
  if (v >= 60) return "#3b82f6"; // blue
  if (v >= 40) return "#f59e0b"; // amber
  return "#ef4444"; // red
}

export default function ScoreGauge({
  value,
  max = 100,
  threshold,
  label,
  sublabel,
  size = 120,
  color,
  showThreshold = true,
}: ScoreGaugeProps) {
  const v = typeof value === "number" && !Number.isNaN(value) ? value : 0;
  const pct = Math.max(0, Math.min(1, v / max));
  const stroke = 10;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const c = 2 * Math.PI * r;
  const dash = c * pct;
  const arcColor = color ?? bandColor(v);
  const thresholdAngle =
    threshold != null && showThreshold
      ? (Math.max(0, Math.min(1, threshold / max)) * 360 - 90) * (Math.PI / 180)
      : null;
  const tx = thresholdAngle != null ? cx + r * Math.cos(thresholdAngle) : 0;
  const ty = thresholdAngle != null ? cy + r * Math.sin(thresholdAngle) : 0;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {/* Track */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            stroke="#e2e8f0"
            strokeWidth={stroke}
            fill="none"
          />
          {/* Filled arc */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            stroke={arcColor}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c - dash}`}
            style={{ transition: "stroke-dasharray 600ms ease-out" }}
          />
        </svg>
        {/* Threshold tick */}
        {thresholdAngle != null && (
          <span
            className="absolute w-1.5 h-1.5 rounded-full bg-slate-700 ring-2 ring-white"
            style={{
              left: tx - 3,
              top: ty - 3,
              transform: "translate(0,0)",
            }}
            aria-hidden
          />
        )}
        {/* Centre value */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums text-slate-900">
            {value == null ? "—" : Math.round(v)}
          </span>
          {sublabel && (
            <span className="text-[10px] uppercase tracking-wider text-slate-400">
              {sublabel}
            </span>
          )}
        </div>
      </div>
      {label && (
        <p className="mt-2 text-xs font-semibold text-slate-600 uppercase tracking-wider">
          {label}
        </p>
      )}
    </div>
  );
}
