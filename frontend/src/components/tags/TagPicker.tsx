"use client";

import { useEffect, useRef, useState } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";
import { apiGet, apiPost } from "@/lib/api";
import TagChip, { TagSummary } from "./TagChip";
import { TAG_PALETTE, swatchClass } from "./colors";

interface TenantTag {
  id: number;
  name: string;
  color: string;
  candidate_count?: number;
  created_at: string | null;
}

/**
 * Combobox that lets HR apply existing tags to a candidate, or create a new
 * tag inline (create-on-fly). Caller controls the "applied" state and gets
 * a callback per add — actual API write of the link happens in the parent
 * (so this component stays usable for both single-candidate and bulk flows).
 */
export default function TagPicker({
  applied,
  onAdd,
  onCreateAndAdd,
  buttonLabel = "Add tag",
}: {
  applied: TagSummary[];
  onAdd: (tag: TagSummary) => Promise<void> | void;
  onCreateAndAdd?: (tag: TagSummary) => Promise<void> | void;
  buttonLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<TenantTag[]>([]);
  const [query, setQuery] = useState("");
  const [color, setColor] = useState("indigo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    (async () => {
      try {
        const res = await apiGet<{ tags: TenantTag[] }>("/tags");
        if (!cancel) setTags(res.tags ?? []);
      } catch {
        if (!cancel) setTags([]);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery("");
      setError(null);
    }
  }, [open]);

  const appliedIds = new Set(applied.map((t) => t.id));
  const q = query.trim().toLowerCase();
  const filtered = tags
    .filter((t) => !appliedIds.has(t.id))
    .filter((t) => !q || t.name.toLowerCase().includes(q))
    .slice(0, 20);
  const exactMatch = tags.find((t) => t.name.toLowerCase() === q);
  const showCreate = !!q && !exactMatch && !!onCreateAndAdd;

  const addExisting = async (tag: TenantTag) => {
    try {
      setBusy(true);
      setError(null);
      await onAdd({ id: tag.id, name: tag.name, color: tag.color });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add tag");
    } finally {
      setBusy(false);
    }
  };

  const createTagInline = async () => {
    if (!q || !onCreateAndAdd) return;
    try {
      setBusy(true);
      setError(null);
      const created = await apiPost<{ id: number; name: string; color: string }>(
        "/tags",
        { name: query.trim(), color },
      );
      await onCreateAndAdd({ id: created.id, name: created.name, color: created.color });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create tag");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-slate-600 border border-dashed border-slate-300 rounded-full hover:bg-slate-50"
      >
        <PlusIcon className="h-3 w-3" />
        {buttonLabel}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute z-50 mt-1 w-72 bg-white border border-slate-200 rounded-lg shadow-lg p-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find or create a tag..."
              className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />

            <div className="mt-2 max-h-56 overflow-y-auto">
              {filtered.length === 0 && !showCreate && (
                <p className="text-xs text-slate-500 px-2 py-2">
                  {q ? "No matches" : "No tags yet — type to create one"}
                </p>
              )}
              {filtered.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  disabled={busy}
                  onClick={() => addExisting(t)}
                  className="w-full text-left px-2 py-1.5 text-sm hover:bg-slate-50 rounded flex items-center gap-2"
                >
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${swatchClass(
                      t.color,
                    )}`}
                  />
                  <span className="flex-1 truncate">{t.name}</span>
                  {t.candidate_count !== undefined && (
                    <span className="text-[11px] text-slate-400">
                      {t.candidate_count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {showCreate && (
              <div className="border-t border-slate-100 mt-2 pt-2">
                <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">
                  Create new tag
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-700 truncate flex-1">
                    {query.trim()}
                  </span>
                  <select
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="text-xs border border-slate-300 rounded px-1 py-0.5"
                  >
                    {TAG_PALETTE.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={createTagInline}
                  disabled={busy}
                  className="mt-2 w-full px-2 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50"
                >
                  {busy ? "Creating..." : `Create "${query.trim()}" and apply`}
                </button>
              </div>
            )}

            {error && (
              <p className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">
                {error}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
