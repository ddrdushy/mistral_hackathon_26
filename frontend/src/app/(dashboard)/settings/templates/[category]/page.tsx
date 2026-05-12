"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowUturnLeftIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";
import { apiGet, apiPut, apiDelete, apiPost } from "@/lib/api";

interface TemplateInfo {
  key: string;
  label: string;
  description: string;
  variables: string[];
  source: "platform_default" | "tenant";
  subject: string;
  body_html: string;
  body_text: string;
  updated_at: string | null;
}

interface PreviewResponse {
  subject: string;
  body_html: string;
  body_text: string;
  from_name: string;
}

export default function TemplateEditorPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = use(params);
  const [info, setInfo] = useState<TemplateInfo | null>(null);
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<TemplateInfo>(`/email-templates/${category}`);
      setInfo(res);
      setSubject(res.subject);
      setBodyHtml(res.body_html);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    load();
  }, [load]);

  // Debounced live preview — 600ms after the user stops typing.
  useEffect(() => {
    if (!info) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      setPreviewing(true);
      try {
        const res = await apiPost<PreviewResponse>(
          `/email-templates/${category}/preview`,
          { subject, body_html: bodyHtml, variables: {} },
        );
        setPreview(res);
      } catch {
        /* keep last preview */
      } finally {
        setPreviewing(false);
      }
    }, 600);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [subject, bodyHtml, category, info]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setNote(null);
    try {
      await apiPut(`/email-templates/${category}`, {
        subject,
        body_html: bodyHtml,
        body_text: "",
      });
      setNote("Saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (
      !confirm(
        "Reset this template back to the platform default? Your custom subject and body will be deleted.",
      )
    ) {
      return;
    }
    setResetting(true);
    setError(null);
    setNote(null);
    try {
      await apiDelete(`/email-templates/${category}`);
      setNote("Reverted to platform default.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  const insertVar = (token: string) => {
    setBodyHtml((b) => b + `{${token}}`);
  };

  if (loading) {
    return (
      <div className="max-w-6xl">
        <div className="h-6 w-64 bg-slate-100 rounded animate-pulse mb-4" />
        <div className="h-64 bg-slate-100 rounded animate-pulse" />
      </div>
    );
  }

  if (!info) {
    return (
      <div className="max-w-3xl">
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error || "Template not found"}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <Link
        href="/settings/templates"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 mb-4"
      >
        <ArrowLeftIcon className="w-4 h-4" />
        All templates
      </Link>

      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{info.label}</h1>
          <p className="text-sm text-slate-600 mt-0.5">{info.description}</p>
        </div>
        <span
          className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded font-semibold ${
            info.source === "tenant"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          {info.source === "tenant" ? "Custom" : "Platform default"}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 mt-5">
        {/* Editor */}
        <div className="lg:col-span-3 space-y-3">
          <Field label="Subject">
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>

          <Field label="Body (HTML)">
            <textarea
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              rows={18}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="<p>Hi {candidate_first_name},</p> ..."
            />
            <p className="text-xs text-slate-500 mt-1">
              Plain HTML. Branding shell (logo, colour, signature) is wrapped
              automatically when the email sends. Use the tokens on the right
              for dynamic values.
            </p>
          </Field>

          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save template"}
            </button>
            {info.source === "tenant" && (
              <button
                onClick={reset}
                disabled={resetting}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-medium disabled:opacity-50"
              >
                <ArrowUturnLeftIcon className="w-4 h-4" />
                Reset to default
              </button>
            )}
            {note && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium">
                <CheckCircleIcon className="w-4 h-4" />
                {note}
              </span>
            )}
          </div>
        </div>

        {/* Variables + preview */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
              Variables
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              Click to insert into the body at the cursor (appends to end).
            </p>
            <div className="flex flex-wrap gap-1.5">
              {info.variables.map((v) => (
                <button
                  key={v}
                  onClick={() => insertVar(v)}
                  className="text-[11px] font-mono px-2 py-1 rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                >
                  {"{" + v + "}"}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center justify-between">
              <span>Preview</span>
              {previewing && (
                <span className="text-[10px] text-slate-400">rendering…</span>
              )}
            </div>
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 text-xs">
              <div className="text-slate-500">
                From:{" "}
                <span className="font-medium text-slate-700">
                  {preview?.from_name || "—"}
                </span>
              </div>
              <div className="text-slate-500 mt-1">
                Subject:{" "}
                <span className="font-medium text-slate-900">
                  {preview?.subject || subject}
                </span>
              </div>
            </div>
            <iframe
              title="Email preview"
              srcDoc={preview?.body_html || ""}
              className="w-full h-[420px] bg-white"
              sandbox=""
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-slate-700 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
