"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowPathIcon,
  ChartBarIcon,
  ExclamationCircleIcon,
} from "@heroicons/react/24/outline";
import Card from "@/components/ui/Card";
import { apiGet, apiPost } from "@/lib/api";

interface Forecast {
  id: number | null;
  job_id: number | null;
  window_days: number;
  run_at: string | null;
  expected_hires: number;
  confidence_low: number;
  confidence_high: number;
  open_applications: number;
  breakdown: { application_id: number; prob: number; expected_remaining_hours: number }[];
  notes: string;
  cached: boolean;
}

const WINDOW_OPTIONS = [
  { days: 30, label: "30d" },
  { days: 60, label: "60d" },
  { days: 90, label: "90d" },
];

export default function PipelineForecastCard({
  jobId,
  title,
}: {
  jobId?: number | null;
  title?: string;
}) {
  const [data, setData] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [windowDays, setWindowDays] = useState(30);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params: Record<string, string> = { window_days: String(windowDays) };
      if (jobId) params.job_id = String(jobId);
      const res = await apiGet<Forecast>("/forecasts/pipeline", params);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [jobId, windowDays]);

  useEffect(() => {
    load();
  }, [load]);

  const recompute = async () => {
    try {
      setBusy(true);
      setError(null);
      const res = await apiPost<Forecast>("/forecasts/pipeline/recompute", {
        job_id: jobId ?? null,
        window_days: windowDays,
      });
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recompute failed");
    } finally {
      setBusy(false);
    }
  };

  const heading = title ?? (jobId ? "Job forecast" : "Hiring forecast");

  const renderNotes = () => {
    if (!data?.notes) return null;
    const msg = {
      cold_start_defaults:
        "Using industry-default rates — accuracy improves as you accumulate transition history.",
      no_template: "Pipeline template missing.",
      no_stages: "Template has no stages.",
      job_closed: "Job is closed — no future hires expected.",
    }[data.notes] || data.notes;
    return (
      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2 inline-flex items-center gap-1">
        <ExclamationCircleIcon className="h-3.5 w-3.5" />
        {msg}
      </p>
    );
  };

  return (
    <Card
      title={heading}
      action={
        <div className="flex items-center gap-1.5">
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            className="text-xs px-2 py-1 border border-slate-300 rounded"
          >
            {WINDOW_OPTIONS.map((o) => (
              <option key={o.days} value={o.days}>
                Next {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={recompute}
            disabled={busy}
            title="Force recompute"
            className="text-slate-500 hover:text-slate-800 disabled:opacity-50"
          >
            <ArrowPathIcon className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          </button>
        </div>
      }
    >
      {loading ? (
        <div className="h-24 bg-slate-100 rounded animate-pulse" />
      ) : !data ? (
        <p className="text-sm text-slate-500">
          {error || "No forecast available."}
        </p>
      ) : data.open_applications === 0 ? (
        <div className="text-sm text-slate-500 flex items-center gap-2">
          <ChartBarIcon className="h-4 w-4 text-slate-400" />
          No open applications in the pipeline.
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-3">
            <div className="text-3xl font-bold text-indigo-700 tabular-nums">
              {data.expected_hires.toFixed(1)}
            </div>
            <div className="text-xs text-slate-500">
              expected hires in next {data.window_days} days
            </div>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            90% confidence band:{" "}
            <span className="font-medium text-slate-800 tabular-nums">
              {data.confidence_low}–{data.confidence_high}
            </span>{" "}
            from {data.open_applications} open application
            {data.open_applications === 1 ? "" : "s"}
          </div>

          {/* Tiny histogram-style strip of contribution probabilities */}
          {data.breakdown.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">
                Per-application contribution
              </p>
              <div className="flex items-end gap-0.5 h-12">
                {data.breakdown.slice(0, 40).map((b) => (
                  <div
                    key={b.application_id}
                    title={`App #${b.application_id} · ${(b.prob * 100).toFixed(1)}% · ~${Math.round(b.expected_remaining_hours)}h`}
                    style={{ height: `${Math.max(2, b.prob * 100)}%` }}
                    className="flex-1 bg-indigo-300 hover:bg-indigo-500 rounded-sm"
                  />
                ))}
              </div>
            </div>
          )}

          {renderNotes()}

          {data.run_at && (
            <p className="text-[11px] text-slate-400 mt-2">
              Last computed {new Date(data.run_at).toLocaleString()}
              {data.cached && " (cached)"}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
