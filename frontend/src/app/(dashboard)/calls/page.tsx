"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowPathIcon,
  PhoneIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import { apiGet, apiPost } from "@/lib/api";
import { timeAgo } from "@/lib/constants";
import FeatureLockBanner from "@/components/entitlements/FeatureLockBanner";

interface CallRow {
  id: number;
  candidate_id: number;
  app_id: number | null;
  purpose: string;
  status: string;
  scheduled_for: string | null;
  attempted_at: string | null;
  completed_at: string | null;
  to_phone: string;
  from_phone: string;
  twilio_call_sid: string;
  transcript: string;
  outcome: string;
  outcome_details: Record<string, unknown>;
  retry_count: number;
  last_error: string;
  rescheduled_to_id: number | null;
  created_at: string | null;
  candidate?: { id: number; name: string; email: string } | null;
}

interface CallSummary {
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  cancelled: number;
  rescheduled: number;
  total: number;
}

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "pending,in_progress", label: "Active" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
  { id: "cancelled,rescheduled", label: "Cancelled" },
] as const;

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-indigo-100 text-indigo-700",
  in_progress: "bg-amber-100 text-amber-700",
  completed: "bg-emerald-100 text-emerald-700",
  failed: "bg-rose-100 text-rose-700",
  cancelled: "bg-slate-100 text-slate-600",
  rescheduled: "bg-slate-100 text-slate-600",
};

const PURPOSE_LABEL: Record<string, string> = {
  screening: "Screening",
  reschedule: "Reschedule",
  reminder: "Reminder",
  availability_check: "Availability check",
  custom: "Custom",
};

export default function CallQueuePage() {
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [summary, setSummary] = useState<CallSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] =
    useState<(typeof STATUS_FILTERS)[number]["id"]>("all");
  const [openCall, setOpenCall] = useState<CallRow | null>(null);

  const fetchData = useCallback(
    async (refresh = false) => {
      try {
        if (refresh) setRefreshing(true);
        else setLoading(true);
        const params: Record<string, string> = { limit: "100" };
        if (statusFilter !== "all") params.status = statusFilter;
        const [list, sum] = await Promise.all([
          apiGet<{ calls: CallRow[] }>("/calls", params),
          apiGet<CallSummary>("/calls/summary"),
        ]);
        setCalls(list.calls ?? []);
        setSummary(sum);
      } catch {
        setCalls([]);
        setSummary(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [statusFilter],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh active calls every 15s so HR sees status changes without
  // having to hit the refresh button.
  useEffect(() => {
    const hasActive =
      calls.some((c) => c.status === "pending" || c.status === "in_progress");
    if (!hasActive) return;
    const id = setInterval(() => fetchData(true), 15000);
    return () => clearInterval(id);
  }, [calls, fetchData]);

  const cancel = async (id: number) => {
    if (!confirm("Cancel this scheduled call?")) return;
    try {
      await apiPost(`/calls/${id}/cancel`);
      fetchData(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Cancel failed");
    }
  };

  return (
    <div className="space-y-4">
      <FeatureLockBanner
        agent="voice_screener"
        featureLabel="Voice screening"
        description="Outbound AI voice calls (powered by ElevenLabs) are part of the Business plan. The call queue still surfaces past calls for tenants that get added later — but new calls can't be placed until the feature is enabled."
      />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Call Queue</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Outbound voice calls — scheduled, in-flight, and completed.
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          <ArrowPathIcon
            className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Counter
          label="Pending"
          value={summary?.pending ?? 0}
          tone="indigo"
        />
        <Counter
          label="In progress"
          value={summary?.in_progress ?? 0}
          tone="amber"
        />
        <Counter
          label="Completed"
          value={summary?.completed ?? 0}
          tone="emerald"
        />
        <Counter
          label="Failed"
          value={summary?.failed ?? 0}
          tone="rose"
        />
        <Counter
          label="Total"
          value={summary?.total ?? 0}
          tone="slate"
        />
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto">
        {STATUS_FILTERS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setStatusFilter(tab.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              statusFilter === tab.id
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-16 bg-white border border-slate-200 rounded-lg animate-pulse"
            />
          ))}
        </div>
      ) : calls.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <PhoneIcon className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">
            No calls in this view. Schedule one from any candidate&apos;s detail page.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
          {calls.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/80 cursor-pointer"
              onClick={() => setOpenCall(c)}
            >
              <span
                className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-semibold flex-shrink-0 ${
                  STATUS_BADGE[c.status] || "bg-slate-100 text-slate-600"
                }`}
              >
                {c.status.replace("_", " ")}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {c.candidate ? (
                    <Link
                      href={`/candidates/${c.app_id ?? c.candidate.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm font-semibold text-slate-900 hover:text-indigo-700 truncate"
                    >
                      {c.candidate.name}
                    </Link>
                  ) : (
                    <span className="text-sm font-semibold text-slate-700 truncate">
                      Candidate #{c.candidate_id}
                    </span>
                  )}
                  <span className="text-xs text-slate-500">
                    · {PURPOSE_LABEL[c.purpose] || c.purpose}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    {c.to_phone}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                  {c.scheduled_for && (
                    <span>
                      Scheduled {new Date(c.scheduled_for).toLocaleString()}
                    </span>
                  )}
                  {c.completed_at && (
                    <span>· Completed {timeAgo(c.completed_at)}</span>
                  )}
                  {c.outcome && (
                    <span className="text-emerald-700">
                      · Outcome: {c.outcome}
                    </span>
                  )}
                  {c.last_error && (
                    <span className="text-rose-700 truncate">
                      · {c.last_error.slice(0, 80)}
                    </span>
                  )}
                  {c.retry_count > 0 && c.status === "pending" && (
                    <span className="text-amber-700">
                      · retry #{c.retry_count}
                    </span>
                  )}
                </div>
              </div>
              {c.status === "pending" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    cancel(c.id);
                  }}
                  className="text-xs font-medium text-rose-600 hover:text-rose-800 flex-shrink-0"
                >
                  Cancel
                </button>
              )}
              <ChevronRightIcon className="h-4 w-4 text-slate-300 flex-shrink-0" />
            </div>
          ))}
        </div>
      )}

      {openCall && (
        <CallDetailModal
          call={openCall}
          onClose={() => setOpenCall(null)}
          onChanged={() => {
            setOpenCall(null);
            fetchData(true);
          }}
        />
      )}
    </div>
  );
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "indigo" | "amber" | "emerald" | "rose" | "slate";
}) {
  const toneClass = {
    indigo: "text-indigo-700",
    amber: "text-amber-700",
    emerald: "text-emerald-700",
    rose: "text-rose-700",
    slate: "text-slate-900",
  }[tone];
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className={`text-2xl font-semibold tabular-nums ${toneClass}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function CallDetailModal({
  call,
  onClose,
  onChanged,
}: {
  call: CallRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [newTime, setNewTime] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reschedule = async () => {
    if (!newTime) return;
    try {
      setBusy(true);
      setError(null);
      await apiPost(`/calls/${call.id}/reschedule`, {
        new_time: new Date(newTime).toISOString(),
        note,
      });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reschedule failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Call #{call.id}{" "}
              {call.candidate && (
                <span className="text-slate-400 font-normal">
                  · {call.candidate.name}
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {PURPOSE_LABEL[call.purpose] || call.purpose} · {call.to_phone}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800">
            ✕
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field
              label="Status"
              value={
                <span
                  className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold ${
                    STATUS_BADGE[call.status] || "bg-slate-100 text-slate-600"
                  }`}
                >
                  {call.status.replace("_", " ")}
                </span>
              }
            />
            <Field label="Outcome" value={call.outcome || "—"} />
            <Field
              label="Scheduled for"
              value={
                call.scheduled_for
                  ? new Date(call.scheduled_for).toLocaleString()
                  : "—"
              }
            />
            <Field
              label="Attempted at"
              value={
                call.attempted_at
                  ? new Date(call.attempted_at).toLocaleString()
                  : "—"
              }
            />
            <Field
              label="Completed at"
              value={
                call.completed_at
                  ? new Date(call.completed_at).toLocaleString()
                  : "—"
              }
            />
            <Field label="Twilio SID" value={call.twilio_call_sid || "—"} />
            <Field label="Retries" value={String(call.retry_count)} />
            <Field
              label="Rescheduled to"
              value={
                call.rescheduled_to_id ? `#${call.rescheduled_to_id}` : "—"
              }
            />
          </div>

          {call.last_error && (
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
                Last error
              </p>
              <p className="text-sm bg-rose-50 border border-rose-200 text-rose-800 rounded-md px-3 py-2">
                {call.last_error}
              </p>
            </div>
          )}

          {call.transcript && (
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
                Transcript
              </p>
              <pre className="text-sm bg-slate-50 border border-slate-200 rounded-md px-3 py-2 max-h-64 overflow-y-auto whitespace-pre-wrap font-sans">
                {call.transcript}
              </pre>
            </div>
          )}

          {Object.keys(call.outcome_details ?? {}).length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
                Details
              </p>
              <pre className="text-xs bg-slate-50 border border-slate-200 rounded-md px-3 py-2 max-h-40 overflow-y-auto">
                {JSON.stringify(call.outcome_details, null, 2)}
              </pre>
            </div>
          )}

          {(call.status === "completed" || call.status === "failed") && (
            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                Reschedule a new attempt
              </p>
              <div className="flex flex-col gap-2">
                <input
                  type="datetime-local"
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional reason / note"
                  className="px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  onClick={reschedule}
                  disabled={busy || !newTime}
                  className="self-start px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50"
                >
                  {busy ? "Rescheduling..." : "Reschedule"}
                </button>
                {error && (
                  <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                    {error}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
          {call.app_id && (
            <Link
              href={`/candidates/${call.app_id}`}
              className="px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-md"
            >
              Open candidate
            </Link>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-md"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1">
        {label}
      </p>
      <div className="text-sm text-slate-800 font-mono break-all">{value}</div>
    </div>
  );
}
