"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownTrayIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { timeAgo } from "@/lib/constants";
import TagChip from "@/components/tags/TagChip";
import TagPicker from "@/components/tags/TagPicker";
import { swatchClass } from "@/components/tags/colors";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api/v1";

interface TenantTag {
  id: number;
  name: string;
  color: string;
  candidate_count: number;
}

type TalentBankStatus =
  | "available"
  | "joined_another"
  | "not_available"
  | "hired_elsewhere";

interface TalentBankCandidate {
  id: number;
  name: string;
  email: string;
  phone: string;
  resume_filename: string;
  cv_version?: number;
  application_count: number;
  // Most-recent application id, when the candidate has at least one.
  // Used to link the card to that app's detail page.
  first_application_id?: number | null;
  tags?: { id: number; name: string; color: string }[];
  profile?: {
    role?: string;
    seniority?: string;
    years_experience?: number | null;
    summary?: string;
    skills?: string[];
    key_points?: string[];
    extracted_at?: string | null;
  };
  talent_bank_status?: TalentBankStatus;
  talent_bank_status_reason?: string;
  talent_bank_status_updated_at?: string | null;
  created_at?: string | null;
}

const TALENT_STATUS_BADGE: Record<TalentBankStatus, { label: string; cls: string; hint: string }> = {
  available: {
    label: "Available",
    cls: "bg-emerald-100 text-emerald-700 border-emerald-200",
    hint: "In the market — surfaces in match results.",
  },
  joined_another: {
    label: "Joined elsewhere",
    cls: "bg-slate-200 text-slate-700 border-slate-300",
    hint: "Candidate replied that they've joined another company. Excluded from future matches.",
  },
  not_available: {
    label: "Not available",
    cls: "bg-amber-100 text-amber-800 border-amber-200",
    hint: "Candidate said they're not currently looking. Excluded from future matches.",
  },
  hired_elsewhere: {
    label: "Hired elsewhere",
    cls: "bg-slate-200 text-slate-700 border-slate-300",
    hint: "Manually marked as hired by another company.",
  },
};

export default function TalentBankPage() {
  const [items, setItems] = useState<TalentBankCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showOnlyUnassigned, setShowOnlyUnassigned] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Tag filter state
  const [tags, setTags] = useState<TenantTag[]>([]);
  const [activeTagIds, setActiveTagIds] = useState<number[]>([]);

  // Multi-select for bulk-tagging / bulk-enroll
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);

  const fetchTags = useCallback(async () => {
    try {
      const res = await apiGet<{ tags: TenantTag[] }>("/tags");
      setTags(res.tags ?? []);
    } catch {
      setTags([]);
    }
  }, []);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = { per_page: "100" };
      if (search.trim()) params.search = search.trim();
      if (showOnlyUnassigned) params.talent_bank_only = "true";
      if (activeTagIds.length > 0) params.tag_ids = activeTagIds.join(",");
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
  }, [search, showOnlyUnassigned, activeTagIds]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags, refreshKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  const toggleTagFilter = (tagId: number) => {
    setActiveTagIds((cur) =>
      cur.includes(tagId) ? cur.filter((t) => t !== tagId) : [...cur, tagId],
    );
  };

  const toggleSelected = (cid: number) => {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const bulkApplyTag = async (tagId: number, action: "add" | "remove") => {
    if (selectedIds.size === 0) return;
    try {
      setBulkBusy(true);
      setBulkResult(null);
      const res = await apiPost<{ rows_added?: number; rows_removed?: number }>(
        "/candidates/bulk-tag",
        {
          candidate_ids: Array.from(selectedIds),
          tag_ids: [tagId],
          action,
        },
      );
      setBulkResult(
        action === "add"
          ? `Added to ${res.rows_added ?? 0} candidate(s)`
          : `Removed from ${res.rows_removed ?? 0} candidate(s)`,
      );
      setRefreshKey((n) => n + 1);
    } catch (err) {
      setBulkResult(err instanceof Error ? err.message : "Bulk action failed");
    } finally {
      setBulkBusy(false);
    }
  };

  const removeTagFromCandidate = async (candidateId: number, tagId: number) => {
    try {
      await apiDelete(`/candidates/${candidateId}/tags/${tagId}`);
      setRefreshKey((n) => n + 1);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove tag");
    }
  };

  const addTagToCandidate = async (candidateId: number, tagId: number) => {
    await apiPost(`/candidates/${candidateId}/tags`, { tag_ids: [tagId] });
    setRefreshKey((n) => n + 1);
  };

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

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-sm">
          <span className="font-medium text-indigo-900">
            {selectedIds.size} selected
          </span>
          {tags.length > 0 ? (
            <>
              <span className="text-indigo-700">Apply tag:</span>
              <div className="flex flex-wrap gap-1">
                {tags.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={bulkBusy}
                    onClick={() => bulkApplyTag(t.id, "add")}
                    className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border bg-white hover:bg-slate-50 disabled:opacity-50"
                  >
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${swatchClass(
                        t.color,
                      )}`}
                    />
                    {t.name}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <span className="text-xs text-indigo-700">
              Create a tag below to bulk-apply
            </span>
          )}
          <button
            type="button"
            onClick={() => setEnrollOpen(true)}
            className="text-xs font-medium px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            Enroll in sequence
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="ml-auto text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            Clear selection
          </button>
        </div>
      )}

      <EnrollInSequenceModal
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        onEnrolled={(msg) => {
          setEnrollOpen(false);
          setBulkResult(msg);
          clearSelection();
          setRefreshKey((n) => n + 1);
        }}
        candidateIds={Array.from(selectedIds)}
      />
      {bulkResult && (
        <p className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded px-3 py-2">
          {bulkResult}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
        {/* Tag filter sidebar */}
        <aside className="bg-white border border-slate-200 rounded-xl p-3 self-start sticky top-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Tags
            </h2>
            <TagPicker
              applied={[]}
              onAdd={async () => {
                /* no-op — sidebar uses create-only flow */
              }}
              onCreateAndAdd={async (tag) => {
                setTags((cur) => [
                  ...cur,
                  { id: tag.id, name: tag.name, color: tag.color || "indigo", candidate_count: 0 },
                ]);
                fetchTags();
              }}
              buttonLabel="New"
            />
          </div>
          {tags.length === 0 ? (
            <p className="text-xs text-slate-500">
              No tags yet. Click <strong>New</strong> to create one.
            </p>
          ) : (
            <ul className="space-y-1">
              {tags.map((t) => {
                const active = activeTagIds.includes(t.id);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => toggleTagFilter(t.id)}
                      className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 transition ${
                        active
                          ? "bg-indigo-50 border border-indigo-200 text-indigo-900"
                          : "hover:bg-slate-50 border border-transparent"
                      }`}
                    >
                      <span
                        className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${swatchClass(
                          t.color,
                        )}`}
                      />
                      <span className="flex-1 truncate">{t.name}</span>
                      <span className="text-[11px] text-slate-400 tabular-nums">
                        {t.candidate_count}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {activeTagIds.length > 0 && (
            <button
              type="button"
              onClick={() => setActiveTagIds([])}
              className="mt-2 w-full text-xs text-slate-500 hover:text-slate-800 px-2 py-1"
            >
              Clear filter
            </button>
          )}
        </aside>

        {/* Cards */}
        <div>
          {loading ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
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
                {activeTagIds.length > 0
                  ? "No candidates match the selected tag(s)."
                  : "No candidates yet. Upload CVs to seed your talent bank."}
              </p>
              {activeTagIds.length === 0 && (
                <button
                  onClick={() => setUploadOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                >
                  <ArrowDownTrayIcon className="h-4 w-4 rotate-180" />
                  Upload your first CV
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {items.map((c) => {
                const isSelected = selectedIds.has(c.id);
                const status: TalentBankStatus = c.talent_bank_status || "available";
                const unavailable = status !== "available";
                const statusBadge = TALENT_STATUS_BADGE[status];
                return (
                  <div
                    key={c.id}
                    className={`bg-white border rounded-xl p-4 hover:shadow-sm transition ${
                      isSelected
                        ? "border-indigo-400 ring-1 ring-indigo-200"
                        : "border-slate-200 hover:border-indigo-300"
                    } ${unavailable ? "opacity-70" : ""}`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelected(c.id)}
                        className="mt-1 rounded border-slate-300 flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900 truncate">
                              {c.first_application_id ? (
                                <a
                                  href={`/candidates/${c.first_application_id}`}
                                  className="hover:text-indigo-700 hover:underline"
                                >
                                  {c.name}
                                </a>
                              ) : (
                                <span>{c.name}</span>
                              )}
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
                            {/* Always-visible details so the card is useful
                                BEFORE the LLM profile extractor has run.
                                Resolves TC-4.1 — a manually-uploaded CV is
                                now visibly represented even on a fresh
                                tenant. */}
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                              {c.resume_filename && (
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600"
                                  title={c.resume_filename}
                                >
                                  📄 {c.resume_filename}
                                  {c.cv_version && c.cv_version > 1
                                    ? ` · v${c.cv_version}`
                                    : ""}
                                </span>
                              )}
                              {c.phone && (
                                <span className="inline-flex items-center gap-1 text-slate-500">
                                  ☎ {c.phone}
                                </span>
                              )}
                              {!c.profile?.extracted_at && (
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700"
                                  title="The AI hasn't finished extracting the role / skills / summary for this CV yet. This usually happens within a minute of upload; refresh to check."
                                >
                                  ⏳ Profile pending
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex-shrink-0 flex flex-col items-end gap-1">
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
                            {unavailable && (
                              <span
                                className={`text-[11px] px-2 py-0.5 rounded border ${statusBadge.cls}`}
                                title={statusBadge.hint}
                              >
                                {statusBadge.label}
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

                        {/* Hand-applied tags */}
                        <div className="mt-2 flex flex-wrap gap-1 items-center">
                          {(c.tags ?? []).map((t) => (
                            <TagChip
                              key={t.id}
                              tag={t}
                              size="xs"
                              onRemove={() => removeTagFromCandidate(c.id, t.id)}
                            />
                          ))}
                          <TagPicker
                            applied={c.tags ?? []}
                            onAdd={(tag) => addTagToCandidate(c.id, tag.id)}
                            onCreateAndAdd={(tag) => addTagToCandidate(c.id, tag.id)}
                            buttonLabel="Tag"
                          />
                        </div>

                        {c.profile?.skills && c.profile.skills.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
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
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

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

function EnrollInSequenceModal({
  open,
  onClose,
  onEnrolled,
  candidateIds,
}: {
  open: boolean;
  onClose: () => void;
  onEnrolled: (msg: string) => void;
  candidateIds: number[];
}) {
  interface SeqOpt {
    id: number;
    name: string;
    is_active: boolean;
  }
  const [sequences, setSequences] = useState<SeqOpt[]>([]);
  const [seqId, setSeqId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    (async () => {
      try {
        const res = await apiGet<{ sequences: SeqOpt[] }>("/outreach/sequences");
        if (cancel) return;
        const active = (res.sequences ?? []).filter((s) => s.is_active);
        setSequences(active);
        setSeqId(active[0]?.id ?? null);
      } catch {
        setSequences([]);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    if (!seqId) return;
    try {
      setBusy(true);
      setError(null);
      const res = await apiPost<{ enrolled: number; skipped_already_active: number[] }>(
        "/outreach/enrollments",
        { sequence_id: seqId, candidate_ids: candidateIds },
      );
      onEnrolled(
        `Enrolled ${res.enrolled} candidate(s)${
          res.skipped_already_active.length
            ? ` · ${res.skipped_already_active.length} already in this sequence`
            : ""
        }`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enroll failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">
            Enroll in sequence
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {candidateIds.length} candidate
            {candidateIds.length === 1 ? "" : "s"} selected
          </p>
        </div>
        <div className="px-6 py-4">
          {sequences.length === 0 ? (
            <p className="text-sm text-slate-500">
              No active sequences yet.{" "}
              <a href="/outreach" className="text-indigo-600 hover:underline">
                Create one →
              </a>
            </p>
          ) : (
            <select
              value={seqId ?? ""}
              onChange={(e) => setSeqId(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {sequences.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          {error && (
            <p className="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </div>
        <div className="px-6 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-md"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !seqId}
            className="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50"
          >
            {busy ? "Enrolling..." : "Enroll"}
          </button>
        </div>
      </div>
    </div>
  );
}
