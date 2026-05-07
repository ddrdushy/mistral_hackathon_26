"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownTrayIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { apiGet } from "@/lib/api";
import { timeAgo } from "@/lib/constants";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api/v1";

interface TalentBankCandidate {
  id: number;
  name: string;
  email: string;
  phone: string;
  resume_filename: string;
  cv_version?: number;
  application_count: number;
  profile?: {
    role?: string;
    seniority?: string;
    years_experience?: number | null;
    summary?: string;
    skills?: string[];
    key_points?: string[];
    extracted_at?: string | null;
  };
  created_at?: string | null;
}

export default function TalentBankPage() {
  const [items, setItems] = useState<TalentBankCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showOnlyUnassigned, setShowOnlyUnassigned] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = { per_page: "100" };
      if (search.trim()) params.search = search.trim();
      if (showOnlyUnassigned) params.talent_bank_only = "true";
      const res = await apiGet<{ candidates: TalentBankCandidate[] }>(
        "/candidates",
        params,
      );
      setItems(res.candidates ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [search, showOnlyUnassigned]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  const totalProfiled = items.filter((c) => c.profile?.extracted_at).length;
  const unassignedCount = items.filter((c) => c.application_count === 0).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Talent Bank</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {items.length} candidate{items.length === 1 ? "" : "s"} ·{" "}
            {totalProfiled} with AI profile · {unassignedCount} unassigned
          </p>
        </div>
        <button
          onClick={() => setUploadOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <ArrowDownTrayIcon className="h-4 w-4 rotate-180" />
          Upload CV
        </button>
      </div>

      <div className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 p-3">
        <div className="relative flex-1 max-w-md">
          <MagnifyingGlassIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="search"
            placeholder="Search name, email, role..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            checked={showOnlyUnassigned}
            onChange={(e) => setShowOnlyUnassigned(e.target.checked)}
            className="rounded border-slate-300"
          />
          Unassigned only
        </label>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-32 bg-white border border-slate-200 rounded-xl animate-pulse"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <p className="text-sm text-slate-500 mb-4">
            No candidates yet. Upload CVs to seed your talent bank.
          </p>
          <button
            onClick={() => setUploadOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
          >
            <ArrowDownTrayIcon className="h-4 w-4 rotate-180" />
            Upload your first CV
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {items.map((c) => (
            <div
              key={c.id}
              className="bg-white border border-slate-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-sm transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">
                    {c.name}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {c.email}
                    {c.profile?.role && ` · ${c.profile.role}`}
                    {c.profile?.seniority &&
                      c.profile.seniority !== "unknown" &&
                      ` · ${c.profile.seniority}`}
                    {c.profile?.years_experience != null &&
                      c.profile.years_experience > 0 &&
                      ` · ${c.profile.years_experience}y`}
                  </div>
                </div>
                <div className="flex-shrink-0">
                  {c.application_count > 0 ? (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {c.application_count} application
                      {c.application_count === 1 ? "" : "s"}
                    </span>
                  ) : (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-slate-50 text-slate-600 border border-slate-200">
                      Talent bank
                    </span>
                  )}
                </div>
              </div>

              {c.profile?.summary && (
                <p className="text-xs text-slate-600 mt-2 leading-snug line-clamp-2">
                  {c.profile.summary}
                </p>
              )}

              {c.profile?.key_points && c.profile.key_points.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                  {c.profile.key_points.slice(0, 3).map((kp, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="text-emerald-600 flex-shrink-0">·</span>
                      <span className="line-clamp-1">{kp}</span>
                    </li>
                  ))}
                </ul>
              )}

              {c.profile?.skills && c.profile.skills.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {c.profile.skills.slice(0, 6).map((sk) => (
                    <span
                      key={sk}
                      className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200"
                    >
                      {sk}
                    </span>
                  ))}
                </div>
              )}

              {!c.profile?.extracted_at && (
                <p className="text-[11px] text-amber-700 mt-2">
                  Profile pending — will appear after the next sync.
                </p>
              )}

              <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
                {c.resume_filename && (
                  <span className="truncate">{c.resume_filename}</span>
                )}
                {(c.cv_version ?? 1) > 1 && (
                  <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium">
                    v{c.cv_version}
                  </span>
                )}
                {c.created_at && (
                  <span className="ml-auto flex-shrink-0">
                    {timeAgo(c.created_at)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <UploadCvDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => {
          setUploadOpen(false);
          setRefreshKey((n) => n + 1);
        }}
      />
    </div>
  );
}

interface UploadedSummary {
  candidate: {
    id: number;
    name: string;
    email: string;
    profile?: {
      role?: string;
      seniority?: string;
      years_experience?: number | null;
      summary?: string;
      skills?: string[];
      key_points?: string[];
    };
  };
}

interface ParseResult {
  name: string;
  email: string;
  phone: string;
  resume_length: number;
  existing_candidate: {
    id: number;
    name: string;
    current_version: number;
    next_version: number;
  } | null;
}

function UploadCvDialog({
  open,
  onClose,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<UploadedSummary[] | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);

  if (!open) return null;

  const reset = () => {
    setFiles([]);
    setName("");
    setEmail("");
    setPhone("");
    setError(null);
    setResults(null);
    setParsed(null);
  };

  const onFilesChange = async (next: File[]) => {
    setFiles(next);
    setParsed(null);
    if (next.length !== 1) return;
    try {
      setParsing(true);
      const fd = new FormData();
      fd.append("file", next[0]);
      const res = await fetch(`${API_BASE}/candidates/parse`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!res.ok) return;
      const data = (await res.json()) as ParseResult;
      setParsed(data);
      // Pre-fill the override fields ONLY if user hasn't typed anything yet.
      if (!name && data.name) setName(data.name);
      if (!email && data.email) setEmail(data.email);
      if (!phone && data.phone) setPhone(data.phone);
    } catch {
      // Pre-parse is best-effort; submit still works even if it fails.
    } finally {
      setParsing(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) {
      setError("Pick at least one CV file");
      return;
    }
    try {
      setBusy(true);
      setError(null);
      setResults(null);

      if (files.length === 1) {
        const fd = new FormData();
        fd.append("file", files[0]);
        if (name.trim()) fd.append("name", name.trim());
        if (email.trim()) fd.append("email", email.trim());
        if (phone.trim()) fd.append("phone", phone.trim());
        const res = await fetch(`${API_BASE}/candidates/upload`, {
          method: "POST",
          credentials: "include",
          body: fd,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || `Upload failed (${res.status})`);
        }
        const data = (await res.json()) as UploadedSummary;
        setResults([data]);
      } else {
        const fd = new FormData();
        for (const f of files) fd.append("files", f);
        const res = await fetch(`${API_BASE}/candidates/upload-bulk`, {
          method: "POST",
          credentials: "include",
          body: fd,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || `Upload failed (${res.status})`);
        }
        const data = (await res.json()) as {
          results: {
            ok: boolean;
            candidate: UploadedSummary["candidate"] | null;
            error: string | null;
            filename: string;
          }[];
          uploaded: number;
          failed: number;
        };
        setResults(
          data.results
            .filter((r) => r.ok && r.candidate)
            .map((r) => ({ candidate: r.candidate! })),
        );
        if (data.failed > 0) {
          const errs = data.results.filter((r) => !r.ok);
          setError(
            `${data.failed} file(s) failed: ${errs.map((e) => `${e.filename} (${e.error})`).join(", ")}`,
          );
        }
      }
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg"
      >
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">Upload CV</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Drop a resume into the talent bank. We&apos;ll parse contact info
            and tag it for future job matches automatically.
          </p>
        </div>
        <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
              CV files{" "}
              <span className="text-slate-400 normal-case">(one or many)</span>
            </label>
            <input
              type="file"
              accept=".pdf,.docx,.doc,.txt,.tex"
              multiple
              onChange={(e) => onFilesChange(Array.from(e.target.files ?? []))}
              className="block w-full text-sm text-slate-700 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
              required
            />
            {parsing && (
              <p className="text-xs text-indigo-600 mt-1.5">
                Parsing CV...
              </p>
            )}
            {parsed?.existing_candidate && (
              <div className="mt-2 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-md px-3 py-2">
                <span className="font-semibold">{parsed.existing_candidate.name}</span>{" "}
                already exists (v{parsed.existing_candidate.current_version}).
                This upload will save as <strong>v{parsed.existing_candidate.next_version}</strong> on the same candidate.
              </div>
            )}
            {files.length > 0 && (
              <ul className="mt-2 max-h-32 overflow-y-auto text-xs text-slate-600 space-y-0.5">
                {files.map((f, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="truncate">{f.name}</span>
                    <span className="text-slate-400 ml-2 flex-shrink-0">
                      {(f.size / 1024).toFixed(0)} KB
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {files.length > 1 && (
              <p className="text-xs text-indigo-700 mt-2">
                Bulk upload — overrides below are ignored when multiple files
                selected. Each CV is auto-parsed for name/email/phone.
              </p>
            )}
          </div>
          {files.length <= 1 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                    Name{" "}
                    <span className="text-slate-400 normal-case">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Auto-detected from CV"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                    Email{" "}
                    <span className="text-slate-400 normal-case">(optional)</span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Auto-detected from CV"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                  Phone{" "}
                  <span className="text-slate-400 normal-case">(optional)</span>
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Auto-detected from CV"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </>
          )}
          {results && results.length > 0 && (
            <div className="border border-emerald-200 bg-emerald-50 rounded-md p-3 space-y-3">
              <p className="text-xs font-medium text-emerald-800 uppercase tracking-wider">
                {results.length === 1
                  ? "Analysis"
                  : `${results.length} candidates added`}
              </p>
              {results.map((r) => (
                <div
                  key={r.candidate.id}
                  className="text-sm bg-white rounded p-2.5 border border-emerald-200/60"
                >
                  <div className="flex items-center justify-between">
                    <a
                      href={`/candidates/${r.candidate.id}`}
                      className="font-semibold text-slate-900 hover:text-indigo-700"
                    >
                      {r.candidate.name}
                    </a>
                    {r.candidate.profile?.role && (
                      <span className="text-xs text-slate-500">
                        {r.candidate.profile.role}
                        {r.candidate.profile.seniority &&
                          r.candidate.profile.seniority !== "unknown" &&
                          ` · ${r.candidate.profile.seniority}`}
                      </span>
                    )}
                  </div>
                  {r.candidate.profile?.summary && (
                    <p className="text-xs text-slate-700 mt-1 leading-snug">
                      {r.candidate.profile.summary}
                    </p>
                  )}
                  {r.candidate.profile?.key_points &&
                    r.candidate.profile.key_points.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                        {r.candidate.profile.key_points
                          .slice(0, 5)
                          .map((kp, i) => (
                            <li key={i} className="flex gap-1.5">
                              <span className="text-emerald-600 flex-shrink-0">
                                ·
                              </span>
                              <span>{kp}</span>
                            </li>
                          ))}
                      </ul>
                    )}
                  {r.candidate.profile?.skills &&
                    r.candidate.profile.skills.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {r.candidate.profile.skills.slice(0, 8).map((sk) => (
                          <span
                            key={sk}
                            className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200"
                          >
                            {sk}
                          </span>
                        ))}
                      </div>
                    )}
                </div>
              ))}
            </div>
          )}
          {error && (
            <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </div>
        <div className="px-6 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-md"
          >
            {results ? "Done" : "Cancel"}
          </button>
          {!results && (
            <button
              type="submit"
              disabled={busy || files.length === 0}
              className="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50"
            >
              {busy
                ? files.length > 1
                  ? `Analyzing ${files.length} CVs...`
                  : "Analyzing..."
                : files.length > 1
                ? `Upload ${files.length} to talent bank`
                : "Upload to talent bank"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
