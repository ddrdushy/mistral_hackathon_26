"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  PlusIcon,
  TrashIcon,
  StarIcon,
  Square2StackIcon,
} from "@heroicons/react/24/outline";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface Template {
  id: number;
  name: string;
  description: string;
  is_default: boolean;
  is_system: boolean;
  jobs_using?: number;
  created_at: string | null;
  updated_at: string | null;
}

export default function PipelineTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiGet<{ templates: Template[] }>("/pipeline-templates");
      setTemplates(res.templates ?? []);
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
      const t = await apiPost<{ id: number }>("/pipeline-templates", {
        name: createName.trim(),
        is_default: false,
        stages: [
          { label: "New", color: "slate" },
          { label: "Screening", color: "indigo" },
          { label: "Interview", color: "violet" },
          { label: "Offer", color: "amber" },
          { label: "Hired", color: "emerald", is_terminal: true, terminal_outcome: "hired" },
          { label: "Rejected", color: "rose", is_terminal: true, terminal_outcome: "rejected" },
        ],
      });
      setCreateOpen(false);
      setCreateName("");
      window.location.href = `/settings/pipeline-templates/${t.id}`;
    } catch (e) {
      alert(e instanceof Error ? e.message : "Create failed");
    }
  };

  const clone = async (id: number) => {
    try {
      const t = await apiPost<{ id: number }>(`/pipeline-templates/${id}/clone`, {});
      window.location.href = `/settings/pipeline-templates/${t.id}`;
    } catch (e) {
      alert(e instanceof Error ? e.message : "Clone failed");
    }
  };

  const remove = async (id: number, name: string) => {
    if (!confirm(`Delete template "${name}"?`)) return;
    try {
      await apiDelete(`/pipeline-templates/${id}`);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 mb-1"
        >
          <ArrowLeftIcon className="h-3 w-3" />
          Settings
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Pipeline templates
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Define your hiring stages once, assign templates to jobs.
              The default template is auto-seeded for every tenant.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md"
          >
            <PlusIcon className="h-4 w-4" />
            New template
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 bg-white border border-slate-200 rounded animate-pulse" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <p className="text-sm text-slate-500">No templates yet.</p>
        </div>
      ) : (
        <ul className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {templates.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/60"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link
                    href={`/settings/pipeline-templates/${t.id}`}
                    className="text-sm font-semibold text-slate-900 hover:text-indigo-700 truncate"
                  >
                    {t.name}
                  </Link>
                  {t.is_default && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                      <StarIcon className="h-3 w-3" />
                      default
                    </span>
                  )}
                  {t.is_system && (
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                      system
                    </span>
                  )}
                </div>
                {t.description && (
                  <p className="text-xs text-slate-500 mt-0.5 truncate">{t.description}</p>
                )}
                <p className="text-xs text-slate-400 mt-0.5">
                  {(t.jobs_using ?? 0)} job{(t.jobs_using ?? 0) === 1 ? "" : "s"} using this
                </p>
              </div>
              <button
                type="button"
                onClick={() => clone(t.id)}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1"
              >
                <Square2StackIcon className="h-4 w-4" />
                Clone
              </button>
              <Link
                href={`/settings/pipeline-templates/${t.id}`}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
              >
                Edit
              </Link>
              {!t.is_system && (t.jobs_using ?? 0) === 0 && (
                <button
                  type="button"
                  onClick={() => remove(t.id, t.name)}
                  className="text-rose-600 hover:text-rose-800"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
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
              <h2 className="text-base font-semibold text-slate-900">New template</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Starts with a 6-stage starter pipeline you can customise.
              </p>
            </div>
            <div className="px-6 py-4">
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Engineering pipeline"
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
                disabled={!createName.trim()}
                className="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
