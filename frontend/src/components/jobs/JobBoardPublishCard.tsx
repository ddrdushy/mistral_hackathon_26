"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  GlobeAltIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PaperAirplaneIcon,
  ArrowTopRightOnSquareIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { apiGet, apiPost } from "@/lib/api";

interface Connection {
  id: number;
  provider: string;
  enabled: boolean;
  last_error: string;
}

interface Provider {
  id: string;
  name: string;
  enabled: boolean;
}

interface Posting {
  id: number;
  job_id: number;
  provider: string;
  external_id: string;
  external_url: string;
  status: string;
  last_error: string;
  posted_at: string | null;
  unposted_at: string | null;
  updated_at: string | null;
}

const STATUS_TONE: Record<string, string> = {
  published: "bg-emerald-50 text-emerald-700 border-emerald-200",
  pending: "bg-slate-50 text-slate-600 border-slate-200",
  failed: "bg-rose-50 text-rose-700 border-rose-200",
  unpublished: "bg-slate-100 text-slate-500 border-slate-200",
  expired: "bg-amber-50 text-amber-700 border-amber-200",
};

export default function JobBoardPublishCard({ jobId }: { jobId: number }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [postings, setPostings] = useState<Posting[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, p, postsRes] = await Promise.all([
        apiGet<{ connections: Connection[] }>("/job-boards"),
        apiGet<{ providers: Provider[] }>("/job-boards/available"),
        apiGet<{ postings: Posting[] }>(`/jobs/${jobId}/boards`),
      ]);
      setConnections(c.connections || []);
      setProviders(p.providers || []);
      setPostings(postsRes.postings || []);
    } catch {
      setConnections([]);
      setProviders([]);
      setPostings([]);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  // Map for quick lookup of provider display name + posting status per provider.
  const providerName = (id: string) =>
    providers.find((p) => p.id === id)?.name || id;
  const postingByProvider = new Map(postings.map((p) => [p.provider, p]));

  const toggle = (id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const publish = async () => {
    if (selected.size === 0) {
      setError("Pick at least one board.");
      return;
    }
    setError(null);
    setFeedback(null);
    setPublishing(true);
    try {
      const res = await apiPost<{ results: { provider: string; ok: boolean; error?: string }[] }>(
        `/jobs/${jobId}/boards/publish`,
        { providers: Array.from(selected) },
      );
      const ok = res.results.filter((r) => r.ok).length;
      const fail = res.results.length - ok;
      if (fail === 0) {
        setFeedback(`Published to ${ok} board${ok === 1 ? "" : "s"}.`);
      } else if (ok === 0) {
        setError(
          `All ${fail} publishes failed: ${res.results.map((r) => `${r.provider}: ${r.error}`).join("; ")}`,
        );
      } else {
        setFeedback(
          `${ok} succeeded, ${fail} failed. See per-board status below.`,
        );
      }
      setSelected(new Set());
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  };

  const unpublish = async (provider: string) => {
    if (!confirm(`Take this job off ${providerName(provider)}?`)) return;
    try {
      await apiPost(`/jobs/${jobId}/boards/${provider}/unpublish`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to unpublish");
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-sm text-slate-500">Loading job boards…</p>
      </div>
    );
  }

  const activeConnections = connections.filter((c) => c.enabled);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
            <GlobeAltIcon className="w-4 h-4 text-indigo-500" />
            Publish to job boards
          </h3>
          <p className="text-[11px] text-slate-500">
            One click pushes this job to every board you connect.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="text-slate-400 hover:text-slate-700"
          aria-label="Refresh status"
          title="Refresh status"
        >
          <ArrowPathIcon className="w-4 h-4" />
        </button>
      </div>

      {activeConnections.length === 0 ? (
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 text-xs text-slate-600">
          No job boards connected yet.{" "}
          <Link
            href="/settings/job-boards"
            className="font-medium text-indigo-600 hover:text-indigo-700"
          >
            Connect a board →
          </Link>
        </div>
      ) : (
        <>
          {/* Per-connection row */}
          <div className="space-y-1.5">
            {activeConnections.map((c) => {
              const posting = postingByProvider.get(c.provider);
              const checked = selected.has(c.provider);
              return (
                <label
                  key={c.id}
                  className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border ${
                    checked
                      ? "bg-indigo-50 border-indigo-200"
                      : "bg-white border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(c.provider)}
                      className="rounded border-slate-300"
                    />
                    <span className="text-sm font-medium text-slate-800 truncate">
                      {providerName(c.provider)}
                    </span>
                    {posting && (
                      <span
                        className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border ${
                          STATUS_TONE[posting.status] || STATUS_TONE.pending
                        }`}
                      >
                        {posting.status}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {posting?.external_url && (
                      <a
                        href={posting.external_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-[11px] text-indigo-600 hover:text-indigo-800"
                      >
                        View <ArrowTopRightOnSquareIcon className="w-3 h-3" />
                      </a>
                    )}
                    {posting?.status === "published" && (
                      <button
                        type="button"
                        onClick={() => unpublish(c.provider)}
                        className="text-[11px] text-rose-600 hover:text-rose-800"
                      >
                        Unpublish
                      </button>
                    )}
                  </div>
                </label>
              );
            })}
          </div>

          {feedback && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 flex items-center gap-1">
              <CheckCircleIcon className="w-3.5 h-3.5" />
              {feedback}
            </p>
          )}
          {error && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1 flex items-start gap-1">
              <ExclamationTriangleIcon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-slate-500">
              {selected.size === 0
                ? "Select boards to publish."
                : `${selected.size} board${selected.size === 1 ? "" : "s"} selected.`}
            </p>
            <button
              type="button"
              onClick={publish}
              disabled={publishing || selected.size === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
            >
              <PaperAirplaneIcon className="w-4 h-4" />
              {publishing ? "Publishing…" : "Publish selected"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
