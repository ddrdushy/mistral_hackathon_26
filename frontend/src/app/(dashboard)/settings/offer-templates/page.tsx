"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  PlusIcon,
  TrashIcon,
  StarIcon,
  ArrowLeftIcon,
} from "@heroicons/react/24/outline";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";

interface OfferTemplate {
  id: number;
  name: string;
  body_markdown: string;
  fields: { key: string; label: string; type: string; required?: boolean }[];
  requires_approval: boolean;
  is_default: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export default function OfferTemplatesPage() {
  const [templates, setTemplates] = useState<OfferTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<OfferTemplate | null>(null);
  const [defaultBody, setDefaultBody] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [list, def] = await Promise.all([
        apiGet<{ templates: OfferTemplate[] }>("/offer-templates"),
        apiGet<{ body_markdown: string }>("/offer-templates/default-body"),
      ]);
      setTemplates(list.templates ?? []);
      setDefaultBody(def.body_markdown);
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startNew = () => {
    setEditing({
      id: 0,
      name: "",
      body_markdown: defaultBody,
      fields: [],
      requires_approval: false,
      is_default: false,
      created_at: null,
      updated_at: null,
    });
  };

  const saveEditing = async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      alert("Template name required");
      return;
    }
    try {
      if (editing.id === 0) {
        await apiPost("/offer-templates", {
          name: editing.name.trim(),
          body_markdown: editing.body_markdown,
          fields: editing.fields,
          requires_approval: editing.requires_approval,
          is_default: editing.is_default,
        });
      } else {
        await apiPut(`/offer-templates/${editing.id}`, {
          name: editing.name.trim(),
          body_markdown: editing.body_markdown,
          fields: editing.fields,
          requires_approval: editing.requires_approval,
          is_default: editing.is_default,
        });
      }
      setEditing(null);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this template?")) return;
    try {
      await apiDelete(`/offer-templates/${id}`);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  };

  if (editing) {
    return <EditTemplateForm template={editing} onSave={saveEditing} onCancel={() => setEditing(null)} onChange={setEditing} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 mb-1"
          >
            <ArrowLeftIcon className="h-3 w-3" />
            Settings
          </Link>
          <h1 className="text-2xl font-semibold text-slate-900">
            Offer Letter Templates
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Markdown templates with <code className="font-mono">{`{{merge_tags}}`}</code> for
            generating offer letters.
          </p>
        </div>
        <button
          type="button"
          onClick={startNew}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md"
        >
          <PlusIcon className="h-4 w-4" />
          New template
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 bg-white border border-slate-200 rounded animate-pulse" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <p className="text-sm text-slate-500 mb-4">
            No templates yet. The default offer letter is used until you create one.
          </p>
          <button
            type="button"
            onClick={startNew}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md"
          >
            <PlusIcon className="h-4 w-4" />
            Create your first template
          </button>
        </div>
      ) : (
        <ul className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {templates.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/60"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(t)}
                    className="text-sm font-semibold text-slate-900 hover:text-indigo-700 truncate text-left"
                  >
                    {t.name}
                  </button>
                  {t.is_default && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                      <StarIcon className="h-3 w-3" />
                      default
                    </span>
                  )}
                  {t.requires_approval && (
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">
                      approval required
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {t.fields.length} field{t.fields.length === 1 ? "" : "s"}
                  {t.updated_at && (
                    <> · updated {new Date(t.updated_at).toLocaleDateString()}</>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditing(t)}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => remove(t.id)}
                className="text-rose-600 hover:text-rose-800"
                aria-label="Delete"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EditTemplateForm({
  template,
  onSave,
  onCancel,
  onChange,
}: {
  template: OfferTemplate;
  onSave: () => void;
  onCancel: () => void;
  onChange: (t: OfferTemplate) => void;
}) {
  const isNew = template.id === 0;

  const addField = () => {
    onChange({
      ...template,
      fields: [
        ...template.fields,
        { key: "", label: "", type: "text", required: false },
      ],
    });
  };

  const updateField = (idx: number, patch: Partial<OfferTemplate["fields"][number]>) => {
    onChange({
      ...template,
      fields: template.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
    });
  };

  const removeField = (idx: number) => {
    onChange({
      ...template,
      fields: template.fields.filter((_, i) => i !== idx),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 mb-1"
          >
            <ArrowLeftIcon className="h-3 w-3" />
            Templates
          </button>
          <h1 className="text-2xl font-semibold text-slate-900">
            {isNew ? "New offer template" : `Edit: ${template.name}`}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-md"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md"
          >
            {isNew ? "Create" : "Save"}
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
            Name
          </label>
          <input
            type="text"
            value={template.name}
            onChange={(e) => onChange({ ...template, name: e.target.value })}
            placeholder="e.g. Standard Engineer Offer"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={template.is_default}
              onChange={(e) =>
                onChange({ ...template, is_default: e.target.checked })
              }
              className="rounded border-slate-300"
            />
            Default template (used when no template is selected)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={template.requires_approval}
              onChange={(e) =>
                onChange({ ...template, requires_approval: e.target.checked })
              }
              className="rounded border-slate-300"
            />
            Requires approval before sending
          </label>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
            Body (Markdown)
          </label>
          <p className="text-xs text-slate-500 mb-2">
            Use <code className="font-mono">{`{{candidate_name}}`}</code>,{" "}
            <code className="font-mono">{`{{job_title}}`}</code>,{" "}
            <code className="font-mono">{`{{salary}}`}</code>,{" "}
            <code className="font-mono">{`{{start_date}}`}</code>,{" "}
            <code className="font-mono">{`{{location}}`}</code>,{" "}
            <code className="font-mono">{`{{equity}}`}</code>, and any custom fields below.
          </p>
          <textarea
            value={template.body_markdown}
            onChange={(e) => onChange({ ...template, body_markdown: e.target.value })}
            rows={20}
            className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-slate-600 uppercase tracking-wider">
              Custom fields
            </p>
            <button
              type="button"
              onClick={addField}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
            >
              + Add field
            </button>
          </div>
          {template.fields.length === 0 ? (
            <p className="text-xs text-slate-500">
              No custom fields — only the standard salary/start_date/etc. inputs will be shown.
            </p>
          ) : (
            <ul className="space-y-2">
              {template.fields.map((f, i) => (
                <li
                  key={i}
                  className="grid grid-cols-[1fr_1fr_120px_80px_24px] gap-2 items-center"
                >
                  <input
                    type="text"
                    value={f.key}
                    onChange={(e) => updateField(i, { key: e.target.value })}
                    placeholder="merge_tag_key"
                    className="px-2 py-1.5 text-sm font-mono border border-slate-300 rounded-md"
                  />
                  <input
                    type="text"
                    value={f.label}
                    onChange={(e) => updateField(i, { label: e.target.value })}
                    placeholder="UI label"
                    className="px-2 py-1.5 text-sm border border-slate-300 rounded-md"
                  />
                  <select
                    value={f.type}
                    onChange={(e) => updateField(i, { type: e.target.value })}
                    className="px-2 py-1.5 text-sm border border-slate-300 rounded-md"
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="currency">Currency</option>
                    <option value="date">Date</option>
                  </select>
                  <label className="flex items-center gap-1 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={!!f.required}
                      onChange={(e) => updateField(i, { required: e.target.checked })}
                      className="rounded border-slate-300"
                    />
                    Req
                  </label>
                  <button
                    type="button"
                    onClick={() => removeField(i)}
                    className="text-rose-600 hover:text-rose-800"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
