"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  PlusIcon,
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
  PhoneIcon,
} from "@heroicons/react/24/outline";
import { apiGet, apiPost } from "@/lib/api";

interface SequenceCard {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
  stop_on_reply: boolean;
  stop_on_meeting_booked: boolean;
  created_at: string | null;
  updated_at: string | null;
  stats?: Record<string, number>;
}

export default function OutreachListPage() {
  const [sequences, setSequences] = useState<SequenceCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiGet<{ sequences: SequenceCard[] }>("/outreach/sequences");
      setSequences(res.sequences ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!createName.trim()) return;
    try {
      setCreateBusy(true);
      setError(null);
      const seq = await apiPost<{ id: number }>("/outreach/sequences", {
        name: createName.trim(),
      });
      setCreateOpen(false);
      setCreateName("");
      window.location.href = `/outreach/${seq.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreateBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Outreach</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Multi-step automated sequences across email, SMS, and WhatsApp.
            Reply detection auto-stops the sequence.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md"
        >
          <PlusIcon className="h-4 w-4" />
          New sequence
        </button>
      </div>

      {error && (
        <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-36 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : sequences.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 sm:p-12">
          <div className="max-w-xl mx-auto text-center">
            <ChatBubbleLeftRightIcon className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <h2 className="text-base font-semibold text-slate-900">
              No outreach sequences yet
            </h2>
            <p className="text-sm text-slate-500 mt-2">
              Sequences automate a series of touchpoints (email + WhatsApp +
              SMS) to a list of candidates with built-in reply detection.
              Pause on reply, pause on meeting booked, retry after N days —
              configured once, runs in the background.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md"
              >
                <PlusIcon className="h-4 w-4" />
                New sequence
              </button>
              <Link
                href="/jobs"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md"
              >
                Or one-off &quot;Reach out&quot; from a job →
              </Link>
            </div>
            <p className="mt-5 text-xs text-slate-400">
              Looking for ad-hoc reach-out activity? Open any job and use the
              <span className="font-semibold"> From your talent bank </span>
              panel to send a single batch of emails + WhatsApps without a
              sequence.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {sequences.map((s) => {
            const stats = s.stats || {};
            const active = stats.active ?? 0;
            const completed = stats.completed ?? 0;
            const stopped = stats.stopped ?? 0;
            const total = active + completed + stopped + (stats.failed ?? 0) + (stats.paused ?? 0);
            const replyRate = total > 0 ? Math.round((stopped / total) * 100) : 0;
            return (
              <Link
                key={s.id}
                href={`/outreach/${s.id}`}
                className="bg-white border border-slate-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-sm transition block"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="text-sm font-semibold text-slate-900 truncate flex-1">
                    {s.name}
                  </h3>
                  {s.is_active ? (
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                      Active
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                      Paused
                    </span>
                  )}
                </div>
                {s.description && (
                  <p className="text-xs text-slate-500 line-clamp-2">{s.description}</p>
                )}
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <Stat label="Active" value={active} />
                  <Stat label="Completed" value={completed} />
                  <Stat label="Replies" value={stopped} />
                </div>
                {total > 0 && (
                  <p className="text-[11px] text-slate-500 mt-2">
                    {replyRate}% reply rate
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50"
          onClick={() => setCreateOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">New sequence</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Give it a name. You&apos;ll add the steps next.
              </p>
            </div>
            <div className="px-6 py-4">
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Cold candidate outreach"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                onKeyDown={(e) => e.key === "Enter" && create()}
                autoFocus
              />
            </div>
            <div className="px-6 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-md"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={create}
                disabled={createBusy || !createName.trim()}
                className="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50"
              >
                {createBusy ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-base font-semibold text-slate-900 tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}
