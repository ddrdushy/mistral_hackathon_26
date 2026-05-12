"use client";

import { useCallback, useEffect, useState } from "react";
import {
  XMarkIcon,
  PencilSquareIcon,
  TrashIcon,
  ArrowTopRightOnSquareIcon,
  PhoneIcon,
  EnvelopeIcon,
  DocumentIcon,
} from "@heroicons/react/24/outline";
import { apiGet, apiPut, apiDelete } from "@/lib/api";

interface CvVersion {
  version_number: number;
  filename: string;
  source: string;
  uploaded_at: string | null;
  is_current: boolean;
}

interface CandidateDetail {
  id: number;
  name: string;
  email: string;
  phone: string;
  notes: string;
  resume_text: string;
  resume_filename: string;
  cv_version: number;
  tags: { id: number; name: string; color: string }[];
  profile?: {
    role?: string;
    seniority?: string;
    years_experience?: number | null;
    summary?: string;
    skills?: string[];
    key_points?: string[];
    extracted_at?: string | null;
  };
  talent_bank_status?: string;
  talent_bank_status_reason?: string;
  talent_bank_status_updated_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

const STATUS_OPTIONS = [
  { value: "available", label: "Available" },
  { value: "joined_another", label: "Joined elsewhere" },
  { value: "not_available", label: "Not available" },
  { value: "hired_elsewhere", label: "Hired elsewhere" },
];

interface Props {
  candidateId: number;
  applicationId?: number | null; // if the candidate has an application, link to it
  onClose: () => void;
  onChanged: () => void;
}

export default function CandidateDetailDrawer({
  candidateId,
  applicationId,
  onClose,
  onChanged,
}: Props) {
  const [data, setData] = useState<CandidateDetail | null>(null);
  const [versions, setVersions] = useState<CvVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    notes: "",
    talent_bank_status: "available",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, v] = await Promise.all([
        apiGet<CandidateDetail>(`/candidates/${candidateId}`),
        apiGet<{ versions: CvVersion[] }>(`/candidates/${candidateId}/cv-versions`).catch(
          () => ({ versions: [] }),
        ),
      ]);
      setData(c);
      setForm({
        name: c.name || "",
        email: c.email || "",
        phone: c.phone || "",
        notes: c.notes || "",
        talent_bank_status: c.talent_bank_status || "available",
      });
      setVersions(v.versions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiPut(`/candidates/${candidateId}`, form);
      setEditing(false);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete ${data?.name || "this candidate"}? This cannot be undone.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await apiDelete(`/candidates/${candidateId}`);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-slate-200">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-slate-900 truncate">
              {data?.name || "Candidate"}
            </h2>
            {data?.profile?.role && (
              <p className="text-xs text-slate-500 truncate">
                {data.profile.role}
                {data.profile.seniority && data.profile.seniority !== "unknown" && (
                  <> · {data.profile.seniority}</>
                )}
                {data.profile.years_experience != null && data.profile.years_experience > 0 && (
                  <> · {data.profile.years_experience}y</>
                )}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          ) : !data ? (
            <p className="text-sm text-slate-500">Could not load candidate.</p>
          ) : (
            <div className="space-y-5">
              {/* Contact */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Contact
                  </h3>
                  {!editing && (
                    <button
                      onClick={() => setEditing(true)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:text-indigo-900"
                    >
                      <PencilSquareIcon className="w-3.5 h-3.5" />
                      Edit
                    </button>
                  )}
                </div>
                {editing ? (
                  <div className="space-y-2">
                    <Input label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
                    <Input label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
                    <Input label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
                    <label className="block">
                      <span className="text-xs font-medium text-slate-700">Availability</span>
                      <select
                        value={form.talent_bank_status}
                        onChange={(e) => setForm({ ...form, talent_bank_status: e.target.value })}
                        className="mt-1 w-full px-3 py-1.5 rounded-md border border-slate-300 text-sm bg-white"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-slate-700">Notes</span>
                      <textarea
                        value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                        rows={3}
                        maxLength={4000}
                        className="mt-1 w-full px-3 py-1.5 rounded-md border border-slate-300 text-sm"
                      />
                    </label>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={save}
                        disabled={saving}
                        className="inline-flex items-center px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold disabled:opacity-50"
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button
                        onClick={() => {
                          setEditing(false);
                          if (data) {
                            setForm({
                              name: data.name || "",
                              email: data.email || "",
                              phone: data.phone || "",
                              notes: data.notes || "",
                              talent_bank_status: data.talent_bank_status || "available",
                            });
                          }
                        }}
                        className="inline-flex items-center px-3 py-1.5 rounded-md bg-white border border-slate-300 hover:bg-slate-50 text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <ul className="space-y-1.5 text-sm text-slate-700">
                    <li className="flex items-center gap-2">
                      <EnvelopeIcon className="w-4 h-4 text-slate-400" />
                      <span className="font-mono text-xs">{data.email || "—"}</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <PhoneIcon className="w-4 h-4 text-slate-400" />
                      <span className="font-mono text-xs">{data.phone || "—"}</span>
                    </li>
                  </ul>
                )}
              </section>

              {/* Profile */}
              {data.profile?.summary && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                    Summary
                  </h3>
                  <p className="text-sm text-slate-700 whitespace-pre-line">
                    {data.profile.summary}
                  </p>
                </section>
              )}

              {(data.profile?.skills?.length ?? 0) > 0 && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                    Skills
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {data.profile?.skills?.map((s) => (
                      <span
                        key={s}
                        className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {(data.profile?.key_points?.length ?? 0) > 0 && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                    Highlights
                  </h3>
                  <ul className="space-y-1 text-sm text-slate-700">
                    {data.profile?.key_points?.map((p, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-slate-400 mt-1">·</span>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* CV versions */}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  CV history ({versions.length})
                </h3>
                <ul className="space-y-1.5">
                  {versions.map((v) => (
                    <li
                      key={v.version_number}
                      className="flex items-center justify-between gap-3 text-sm text-slate-700 px-3 py-2 rounded-md bg-slate-50 border border-slate-200"
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        <DocumentIcon className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        <span className="truncate" title={v.filename}>
                          v{v.version_number} · {v.filename}
                        </span>
                        {v.is_current && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                            current
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono flex-shrink-0">
                        {v.source}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              {/* Resume text preview */}
              {data.resume_text && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                    Resume text
                  </h3>
                  <pre className="text-xs text-slate-600 whitespace-pre-wrap font-mono bg-slate-50 border border-slate-200 rounded-md p-3 max-h-72 overflow-y-auto">
                    {data.resume_text.slice(0, 8000)}
                    {data.resume_text.length > 8000 && "\n\n…(truncated)"}
                  </pre>
                </section>
              )}

              {error && (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
          <button
            onClick={handleDelete}
            disabled={deleting || loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 text-xs font-semibold disabled:opacity-50"
          >
            <TrashIcon className="w-3.5 h-3.5" />
            {deleting ? "Deleting…" : "Delete candidate"}
          </button>
          {applicationId && (
            <a
              href={`/candidates/${applicationId}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold"
            >
              Open application
              <ArrowTopRightOnSquareIcon className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full px-3 py-1.5 rounded-md border border-slate-300 text-sm"
      />
    </label>
  );
}
