"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  TrashIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import { swatchClass, TAG_PALETTE } from "@/components/tags/colors";

interface Stage {
  id: number;
  template_id: number;
  key: string;
  label: string;
  order_index: number;
  is_terminal: boolean;
  terminal_outcome: string;
  auto_advance_threshold: number | null;
  color: string;
}

interface Template {
  id: number;
  name: string;
  description: string;
  is_default: boolean;
  is_system: boolean;
  jobs_using?: number;
  stages: Stage[];
}

const OUTCOMES = [
  { id: "", label: "—" },
  { id: "hired", label: "Hired" },
  { id: "rejected", label: "Rejected" },
  { id: "withdrawn", label: "Withdrawn" },
];

export default function PipelineTemplateEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const tmplId = Number(id);
  const [tmpl, setTmpl] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const t = await apiGet<Template>(`/pipeline-templates/${tmplId}`);
      setTmpl(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [tmplId]);

  useEffect(() => {
    load();
  }, [load]);

  const saveTmpl = async (patch: Partial<Template>) => {
    try {
      await apiPut(`/pipeline-templates/${tmplId}`, patch);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    }
  };

  const addStage = async () => {
    try {
      await apiPost(`/pipeline-templates/${tmplId}/stages`, {
        label: "New stage",
        color: "slate",
      });
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Add stage failed");
    }
  };

  const updateStage = async (sid: number, patch: Partial<Stage>) => {
    try {
      await apiPut(`/pipeline-templates/${tmplId}/stages/${sid}`, patch);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update stage failed");
    }
  };

  const removeStage = async (sid: number) => {
    if (!confirm("Delete this stage?")) return;
    try {
      await apiDelete(`/pipeline-templates/${tmplId}/stages/${sid}`);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const reorder = async (sid: number, dir: -1 | 1) => {
    if (!tmpl) return;
    const ids = tmpl.stages.map((s) => s.id);
    const idx = ids.indexOf(sid);
    if (idx < 0) return;
    const t = idx + dir;
    if (t < 0 || t >= ids.length) return;
    [ids[idx], ids[t]] = [ids[t], ids[idx]];
    try {
      await apiPost(`/pipeline-templates/${tmplId}/stages/reorder`, {
        stage_ids: ids,
      });
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Reorder failed");
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-12 bg-white border border-slate-200 rounded animate-pulse" />
        <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!tmpl) {
    return (
      <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
        {error || "Template not found"}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/settings/pipeline-templates"
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 mb-1"
        >
          <ArrowLeftIcon className="h-3 w-3" />
          Templates
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={tmpl.name}
              onChange={(e) => setTmpl({ ...tmpl, name: e.target.value })}
              onBlur={(e) => {
                if (e.target.value !== tmpl.name) saveTmpl({ name: e.target.value });
              }}
              className="text-2xl font-semibold text-slate-900 bg-transparent border-0 focus:outline-none focus:ring-0 w-full p-0"
              disabled={tmpl.is_system}
            />
            <textarea
              value={tmpl.description}
              onChange={(e) => setTmpl({ ...tmpl, description: e.target.value })}
              onBlur={(e) => {
                if (e.target.value !== tmpl.description)
                  saveTmpl({ description: e.target.value });
              }}
              rows={1}
              placeholder="Optional description"
              className="text-sm text-slate-500 bg-transparent border-0 focus:outline-none focus:ring-0 mt-0.5 w-full p-0 resize-none"
            />
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={tmpl.is_default}
                onChange={(e) => saveTmpl({ is_default: e.target.checked })}
                className="rounded border-slate-300"
              />
              Default
            </label>
            <span className="text-xs text-slate-500">
              {tmpl.jobs_using ?? 0} job{(tmpl.jobs_using ?? 0) === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {tmpl.stages.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-slate-500 mb-3">No stages yet.</p>
            <button
              type="button"
              onClick={addStage}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md"
            >
              <PlusIcon className="h-4 w-4" />
              Add first stage
            </button>
          </div>
        ) : (
          tmpl.stages.map((s, i) => (
            <div key={s.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => reorder(s.id, -1)}
                  disabled={i === 0}
                  className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                >
                  <ChevronUpIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => reorder(s.id, 1)}
                  disabled={i === tmpl.stages.length - 1}
                  className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                >
                  <ChevronDownIcon className="h-4 w-4" />
                </button>
              </div>

              <span
                className={`inline-block w-3 h-3 rounded-full flex-shrink-0 ${swatchClass(
                  s.color,
                )}`}
              />

              <input
                type="text"
                defaultValue={s.label}
                onBlur={(e) => {
                  if (e.target.value !== s.label) updateStage(s.id, { label: e.target.value });
                }}
                className="flex-1 text-sm font-medium text-slate-800 bg-transparent border-0 focus:outline-none focus:ring-0 p-0"
                placeholder="Stage label"
              />

              <span className="text-xs text-slate-400 font-mono">{s.key}</span>

              <select
                value={s.color}
                onChange={(e) => updateStage(s.id, { color: e.target.value })}
                className="text-xs px-2 py-1 border border-slate-300 rounded"
              >
                {TAG_PALETTE.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>

              <select
                value={s.terminal_outcome || ""}
                onChange={(e) =>
                  updateStage(s.id, {
                    terminal_outcome: e.target.value,
                    is_terminal: !!e.target.value,
                  })
                }
                className="text-xs px-2 py-1 border border-slate-300 rounded"
              >
                {OUTCOMES.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>

              <input
                type="number"
                defaultValue={s.auto_advance_threshold ?? ""}
                placeholder="auto-advance"
                title="Auto-advance score threshold (0-100)"
                onBlur={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  if (v !== s.auto_advance_threshold)
                    updateStage(s.id, { auto_advance_threshold: v });
                }}
                className="w-24 text-xs px-2 py-1 border border-slate-300 rounded"
                min={0}
                max={100}
              />

              <button
                type="button"
                onClick={() => removeStage(s.id)}
                className="text-rose-500 hover:text-rose-700"
                title="Delete stage"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </div>

      {tmpl.stages.length > 0 && (
        <button
          type="button"
          onClick={addStage}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md border border-dashed border-indigo-300"
        >
          <PlusIcon className="h-4 w-4" />
          Add stage
        </button>
      )}

      <p className="text-[11px] text-slate-500">
        Auto-advance threshold: when a stage has a value here and an
        application reaches it via the resume scorer, it auto-moves to the
        next stage. Leave blank for manual progression.
      </p>
    </div>
  );
}
