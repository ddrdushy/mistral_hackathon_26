"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { timeAgo } from "@/lib/constants";
import {
  VideoCameraIcon,
  ClipboardDocumentIcon,
  PaperAirplaneIcon,
  ExclamationCircleIcon,
} from "@heroicons/react/24/outline";

type Status =
  | "generated"
  | "sent"
  | "send_failed"
  | "opened"
  | "interview_started"
  | "interview_completed"
  | "expired";

interface Row {
  id: number;
  token: string;
  app_id: number;
  candidate_id: number;
  candidate_name: string;
  candidate_email: string;
  job_id: number;
  job_code: string;
  job_title: string;
  status: Status;
  interview_url: string;
  expires_at: string | null;
  opened_at: string | null;
  interview_started_at: string | null;
  interview_completed_at: string | null;
  created_at: string | null;
}

const STATUS_BADGE: Record<Status, { label: string; cls: string }> = {
  generated:           { label: "Generated",          cls: "bg-slate-100 text-slate-700" },
  sent:                { label: "Sent",               cls: "bg-indigo-100 text-indigo-700" },
  send_failed:         { label: "Send failed",        cls: "bg-rose-100 text-rose-700" },
  opened:              { label: "Opened",             cls: "bg-violet-100 text-violet-700" },
  interview_started:   { label: "In progress",        cls: "bg-amber-100 text-amber-800" },
  interview_completed: { label: "Completed",          cls: "bg-emerald-100 text-emerald-700" },
  expired:             { label: "Expired",            cls: "bg-slate-100 text-slate-500" },
};

const FILTERS: { value: "all" | Status | "pending"; label: string }[] = [
  { value: "all",                 label: "All" },
  { value: "pending",             label: "Pending follow-up" },
  { value: "sent",                label: "Sent" },
  { value: "send_failed",         label: "Send failed" },
  { value: "opened",              label: "Opened" },
  { value: "interview_started",   label: "In progress" },
  { value: "interview_completed", label: "Completed" },
  { value: "expired",             label: "Expired" },
];

const PENDING_STATUSES: Status[] = ["generated", "sent", "send_failed", "opened"];

export default function InterviewsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("pending");
  const [resending, setResending] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ interviews: Row[] }>("/screening/interview-queue");
      setRows(res.interviews || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "pending") return rows.filter((r) => PENDING_STATUSES.includes(r.status));
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, pending: 0 };
    rows.forEach((r) => {
      c[r.status] = (c[r.status] || 0) + 1;
      if (PENDING_STATUSES.includes(r.status)) c.pending += 1;
    });
    return c;
  }, [rows]);

  const resend = async (row: Row) => {
    setResending(row.id);
    try {
      const res = await apiPost<{ email_sent: boolean; error?: string }>(
        "/screening/send-link",
        { token: row.token },
      );
      if (res.email_sent) {
        // Soft refresh — pull the new status from the queue.
        await load();
      } else {
        alert(`Send failed: ${res.error || "unknown error"}\n\nThe interview URL is still valid — you can copy and send it manually.`);
        await load();
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Resend failed");
    } finally {
      setResending(null);
    }
  };

  const copyUrl = async (row: Row) => {
    try {
      await navigator.clipboard.writeText(row.interview_url);
      setCopied(row.id);
      setTimeout(() => setCopied((c) => (c === row.id ? null : c)), 2000);
    } catch {
      prompt("Copy this interview URL:", row.interview_url);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <VideoCameraIcon className="w-6 h-6 text-indigo-600" />
          <h1 className="text-2xl font-bold text-slate-900">Interviews</h1>
        </div>
        <p className="text-sm text-slate-600">
          Every interview link generated for this tenant — from draft through
          send, open, start, and completion. Use it to chase candidates who
          received a link but haven&apos;t opened it yet.
        </p>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filter === f.value
                ? "bg-indigo-600 text-white"
                : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            {f.label}
            {counts[f.value] !== undefined && (
              <span className={`ml-1 px-1.5 rounded-full text-[10px] font-semibold ${
                filter === f.value ? "bg-white/20" : "bg-slate-100 text-slate-600"
              }`}>
                {counts[f.value]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Body */}
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 bg-slate-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <VideoCameraIcon className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-600">
            No interviews matching this filter yet.
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Generate interview links from a candidate&apos;s detail page.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600 uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Candidate</th>
                <th className="text-left px-4 py-3">Job</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Sent</th>
                <th className="text-left px-4 py-3">Expires</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => {
                const badge = STATUS_BADGE[r.status] ?? STATUS_BADGE.generated;
                const showResend = ["generated", "send_failed", "sent", "opened"].includes(r.status);
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/candidates/${r.app_id}`}
                        className="font-medium text-indigo-600 hover:underline"
                      >
                        {r.candidate_name}
                      </Link>
                      <div className="text-xs text-slate-500 truncate max-w-[220px]">
                        {r.candidate_email}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-800">{r.job_title}</div>
                      <div className="text-xs text-slate-500 font-mono">{r.job_code}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${badge.cls}`}>
                        {r.status === "send_failed" && <ExclamationCircleIcon className="w-3 h-3 mr-1" />}
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {r.created_at ? timeAgo(r.created_at) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {r.expires_at ? timeAgo(r.expires_at) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => copyUrl(r)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                          title="Copy link"
                        >
                          <ClipboardDocumentIcon className="w-3.5 h-3.5" />
                          {copied === r.id ? "Copied" : "Copy"}
                        </button>
                        {showResend && (
                          <button
                            onClick={() => resend(r)}
                            disabled={resending === r.id}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                            title={r.status === "send_failed" ? "Try sending again" : "Resend"}
                          >
                            <PaperAirplaneIcon className="w-3.5 h-3.5" />
                            {resending === r.id
                              ? "…"
                              : r.status === "send_failed"
                                ? "Retry"
                                : "Resend"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
