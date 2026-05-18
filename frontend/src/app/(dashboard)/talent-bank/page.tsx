"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownTrayIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { apiGet, apiPost, apiDelete, apiUrl } from "@/lib/api";
import { useGate } from "@/components/entitlements/EntitlementsProvider";
import { timeAgo } from "@/lib/constants";
import TagChip from "@/components/tags/TagChip";
import TagPicker from "@/components/tags/TagPicker";
import { swatchClass } from "@/components/tags/colors";
import CandidateDetailDrawer from "@/components/talent/CandidateDetailDrawer";

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
  email_missing?: boolean;
  phone: string;
  phone_missing?: boolean;
  name_missing?: boolean;
  missing_fields?: string[];
  resume_filename: string;
  resume_blob_available?: boolean;
  cv_version?: number;
  application_count: number;
  // Counts from the resume fraud detector — populated server-side
  // by the list endpoint. We badge anything with critical signals
  // (prompt-injection / hidden text) in red so HR sees them at a
  // glance, anything else with signals in amber.
  fraud_flags_count?: number;
  fraud_critical?: boolean;
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

  // Pagination + view mode. Both prefs survive reloads via
  // localStorage — recruiters tend to stick with one view.
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number>(() => {
    if (typeof window === "undefined") return 24;
    const v = parseInt(window.localStorage.getItem("hireops.talent.per_page") || "");
    return v === 12 || v === 24 || v === 48 || v === 96 ? v : 24;
  });
  const [total, setTotal] = useState(0);
  const [view, setView] = useState<"tiles" | "list">(() => {
    if (typeof window === "undefined") return "tiles";
    const v = window.localStorage.getItem("hireops.talent.view");
    return v === "list" ? "list" : "tiles";
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("hireops.talent.per_page", String(perPage));
    }
  }, [perPage]);
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("hireops.talent.view", view);
    }
  }, [view]);

  // Click-to-open detail drawer. We open it for ANY candidate row, not
  // just talent-bank-only ones, so HR can edit/delete without
  // round-tripping through the application page.
  const [drawerCand, setDrawerCand] = useState<TalentBankCandidate | null>(null);

  // Tag filter state
  const [tags, setTags] = useState<TenantTag[]>([]);
  const [activeTagIds, setActiveTagIds] = useState<number[]>([]);

  // Skill + seniority + experience filters. Skills is a comma-separated
  // input with AND semantics (candidate must have all of them in the
  // extracted profile). All three persist via URL-encoded params on the
  // /candidates request — same shape the backend already validates.
  const [skillsFilter, setSkillsFilter] = useState<string>("");
  const [skillsInput, setSkillsInput] = useState<string>("");
  const [seniorityFilter, setSeniorityFilter] = useState<string>("");
  const [minYearsFilter, setMinYearsFilter] = useState<string>("");

  // When filters change, jump back to page 1 — otherwise switching
  // from a 5-page set to a filtered 1-page set lands on empty page 4.
  useEffect(() => {
    setPage(1);
  }, [search, showOnlyUnassigned, activeTagIds, skillsFilter, seniorityFilter, minYearsFilter]);

  // Multi-select for bulk-tagging / bulk-enroll
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);

  // Inline resume-text viewer + per-card "re-extract" busy state.
  const [resumeView, setResumeView] = useState<{
    candidate_id: number;
    name: string;
    filename: string;
    cv_version: number;
    resume_text: string;
    resume_blob_available: boolean;
    loading: boolean;
  } | null>(null);
  const [reExtractingId, setReExtractingId] = useState<number | null>(null);

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
      const params: Record<string, string> = {
        per_page: String(perPage),
        page: String(page),
      };
      if (search.trim()) params.search = search.trim();
      if (showOnlyUnassigned) params.talent_bank_only = "true";
      if (activeTagIds.length > 0) params.tag_ids = activeTagIds.join(",");
      if (skillsFilter.trim()) params.skills = skillsFilter.trim();
      if (seniorityFilter) params.seniority = seniorityFilter;
      const yrs = parseFloat(minYearsFilter);
      if (!Number.isNaN(yrs) && yrs > 0) params.min_years = String(yrs);
      const res = await apiGet<{
        candidates: TalentBankCandidate[];
        total?: number;
      }>("/candidates", params);
      setItems(res.candidates ?? []);
      setTotal(res.total ?? (res.candidates?.length ?? 0));
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [search, showOnlyUnassigned, activeTagIds, page, perPage, skillsFilter, seniorityFilter, minYearsFilter]);

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

  const openResumeView = async (c: TalentBankCandidate) => {
    setResumeView({
      candidate_id: c.id,
      name: c.name,
      filename: c.resume_filename || "",
      cv_version: c.cv_version || 1,
      resume_text: "",
      resume_blob_available: !!c.resume_blob_available,
      loading: true,
    });
    try {
      const res = await apiGet<{
        resume_text: string;
        filename: string;
        cv_version: number;
        resume_blob_available: boolean;
      }>(`/candidates/${c.id}/resume/text`);
      setResumeView((cur) =>
        cur && cur.candidate_id === c.id
          ? {
              ...cur,
              resume_text: res.resume_text || "",
              filename: res.filename || cur.filename,
              cv_version: res.cv_version || cur.cv_version,
              resume_blob_available: !!res.resume_blob_available,
              loading: false,
            }
          : cur,
      );
    } catch (err) {
      setResumeView((cur) =>
        cur && cur.candidate_id === c.id
          ? {
              ...cur,
              resume_text:
                err instanceof Error
                  ? `Failed to load: ${err.message}`
                  : "Failed to load resume.",
              loading: false,
            }
          : cur,
      );
    }
  };

  const profileGate = useGate("profile_extractor");

  const reExtractProfile = async (candidateId: number) => {
    if (!profileGate.allowed) {
      const proceed = confirm(
        `AI profile tagging isn't enabled on ${profileGate.planLabel}. Click OK to email us about enabling it.`,
      );
      if (proceed) window.location.href = profileGate.contactHref;
      return;
    }
    setReExtractingId(candidateId);
    try {
      await apiPost(`/candidates/${candidateId}/re-extract`);
      setRefreshKey((n) => n + 1);
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : "Re-extraction failed. Try again in a moment.",
      );
    } finally {
      setReExtractingId(null);
    }
  };

  const totalProfiled = items.filter((c) => c.profile?.extracted_at).length;
  const unassignedCount = items.filter((c) => c.application_count === 0).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Talent Bank</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {total} candidate{total === 1 ? "" : "s"} ·{" "}
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

      <div className="flex flex-wrap items-center gap-3 bg-white rounded-xl border border-slate-200 p-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <MagnifyingGlassIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="search"
            placeholder="Search name, email, role..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Skills filter — comma-separated, AND semantics. Commit on
            blur or Enter so we don't query on every keystroke. */}
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-600 whitespace-nowrap">
            Skills
          </label>
          <input
            type="text"
            placeholder="e.g. Python, AWS"
            value={skillsInput}
            onChange={(e) => setSkillsInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setSkillsFilter(skillsInput);
              }
            }}
            onBlur={() => {
              if (skillsInput !== skillsFilter) setSkillsFilter(skillsInput);
            }}
            className="w-44 text-xs border border-slate-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            title="Comma-separated. Candidate must have ALL listed skills on their extracted profile."
          />
        </div>

        {/* Seniority filter — drives off profile_seniority. */}
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-600 whitespace-nowrap">
            Seniority
          </label>
          <select
            value={seniorityFilter}
            onChange={(e) => setSeniorityFilter(e.target.value)}
            className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white"
            aria-label="Filter by seniority"
          >
            <option value="">Any</option>
            <option value="junior">Junior</option>
            <option value="mid">Mid</option>
            <option value="senior">Senior</option>
            <option value="lead">Lead</option>
            <option value="principal">Principal</option>
          </select>
        </div>

        {/* Minimum years experience floor. */}
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-600 whitespace-nowrap">
            Min yrs
          </label>
          <input
            type="number"
            min={0}
            max={50}
            step={1}
            placeholder="0"
            value={minYearsFilter}
            onChange={(e) => setMinYearsFilter(e.target.value)}
            className="w-16 text-xs border border-slate-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {(skillsFilter || seniorityFilter || minYearsFilter) && (
          <button
            type="button"
            onClick={() => {
              setSkillsInput("");
              setSkillsFilter("");
              setSeniorityFilter("");
              setMinYearsFilter("");
            }}
            className="text-[11px] font-medium text-slate-500 hover:text-slate-800 underline"
          >
            Clear filters
          </button>
        )}

        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            checked={showOnlyUnassigned}
            onChange={(e) => setShowOnlyUnassigned(e.target.checked)}
            className="rounded border-slate-300"
          />
          Unassigned only
        </label>

        {/* Page size — recruiters scanning a large bank pick 48/96;
            anyone reviewing a small batch sticks with 12/24. Persists
            to localStorage. */}
        <select
          value={perPage}
          onChange={(e) => {
            setPerPage(parseInt(e.target.value, 10));
            setPage(1);
          }}
          className="text-xs border border-slate-300 rounded-md px-2 py-1 bg-white"
          aria-label="Candidates per page"
        >
          {[12, 24, 48, 96].map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </select>

        {/* Tiles ↔ list toggle. Tiles = rich cards (default), List =
            one-line rows for fast skimming. */}
        <div
          className="inline-flex rounded-md border border-slate-300 overflow-hidden text-xs"
          role="tablist"
          aria-label="View mode"
        >
          <button
            type="button"
            onClick={() => setView("tiles")}
            className={`px-2 py-1 ${
              view === "tiles"
                ? "bg-indigo-600 text-white"
                : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
            aria-pressed={view === "tiles"}
            title="Tiles view"
          >
            ▦ Tiles
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            className={`px-2 py-1 ${
              view === "list"
                ? "bg-indigo-600 text-white"
                : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
            aria-pressed={view === "list"}
            title="List view"
          >
            ☰ List
          </button>
        </div>
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

      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-4">
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
        <div className="min-w-0">
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
            <div
              className={
                view === "tiles"
                  ? "grid grid-cols-1 xl:grid-cols-2 gap-3"
                  : "flex flex-col gap-1.5"
              }
            >
              {items.map((c) => {
                const isSelected = selectedIds.has(c.id);
                const status: TalentBankStatus = c.talent_bank_status || "available";
                const unavailable = status !== "available";
                const statusBadge = TALENT_STATUS_BADGE[status];
                if (view === "list") {
                  // Compact list row — name, role, missing-field badges,
                  // checkbox, click opens the drawer. Skips the rich
                  // tile content so HR can skim 50 candidates per screen.
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setDrawerCand(c)}
                      className={`text-left bg-white border rounded-lg px-3 py-2 flex items-center gap-3 overflow-hidden w-full hover:border-indigo-300 hover:shadow-sm transition ${
                        isSelected
                          ? "border-indigo-400 ring-1 ring-indigo-200"
                          : "border-slate-200"
                      } ${unavailable ? "opacity-75" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleSelected(c.id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        aria-label={`Select ${c.name}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-slate-900 truncate">
                            {c.name}
                          </span>
                          {c.profile?.role && (
                            <span className="text-xs text-slate-500">
                              · {c.profile.role}
                            </span>
                          )}
                          {c.profile?.seniority &&
                            c.profile.seniority !== "unknown" && (
                              <span className="text-[10px] uppercase tracking-wider text-slate-400">
                                · {c.profile.seniority}
                              </span>
                            )}
                          {(c.missing_fields ?? []).length > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
                              ⚠ Missing {(c.missing_fields ?? []).join(" + ")}
                            </span>
                          )}
                          {(c.fraud_flags_count ?? 0) > 0 && (
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded border ${
                                c.fraud_critical
                                  ? "bg-rose-100 text-rose-800 border-rose-300"
                                  : "bg-amber-50 text-amber-800 border-amber-200"
                              }`}
                              title={
                                c.fraud_critical
                                  ? "Critical fraud signal detected (prompt injection, hidden text). Open the candidate to review."
                                  : `${c.fraud_flags_count} fraud signal${c.fraud_flags_count === 1 ? "" : "s"} detected on this CV.`
                              }
                            >
                              🚩 {c.fraud_critical ? "Fraud" : `${c.fraud_flags_count} flag${c.fraud_flags_count === 1 ? "" : "s"}`}
                            </span>
                          )}
                          {unavailable && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${statusBadge.cls}`}>
                              {statusBadge.label}
                            </span>
                          )}
                        </div>
                        {c.profile?.summary && (
                          <p className="text-xs text-slate-500 mt-0.5 truncate">
                            {c.profile.summary}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {c.resume_blob_available && (
                          <a
                            href={apiUrl(`/candidates/${c.id}/resume/file`)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[11px] font-medium text-indigo-700 hover:text-indigo-900"
                            title="Download CV"
                          >
                            ⤓
                          </a>
                        )}
                        {c.created_at && (
                          <span className="text-[10px] text-slate-400">
                            {timeAgo(c.created_at)}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                }
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
                              <button
                                type="button"
                                onClick={() => setDrawerCand(c)}
                                className="text-left hover:text-indigo-700 hover:underline"
                              >
                                {c.name}
                              </button>
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
                                c.resume_blob_available ? (
                                  <a
                                    href={apiUrl(`/candidates/${c.id}/resume/file`)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 hover:bg-indigo-100 hover:text-indigo-700"
                                    title={`Open original — ${c.resume_filename}`}
                                  >
                                    📄 {c.resume_filename}
                                    {c.cv_version && c.cv_version > 1
                                      ? ` · v${c.cv_version}`
                                      : ""}
                                  </a>
                                ) : (
                                  <span
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600"
                                    title={c.resume_filename}
                                  >
                                    📄 {c.resume_filename}
                                    {c.cv_version && c.cv_version > 1
                                      ? ` · v${c.cv_version}`
                                      : ""}
                                  </span>
                                )
                              )}
                              {!c.phone_missing && c.phone && (
                                <span className="inline-flex items-center gap-1 text-slate-500">
                                  ☎ {c.phone}
                                </span>
                              )}
                              {!c.email_missing && c.email && (
                                <span className="inline-flex items-center gap-1 text-slate-500 truncate max-w-[180px]" title={c.email}>
                                  ✉ {c.email}
                                </span>
                              )}
                              {(c.missing_fields ?? []).length > 0 && (
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200"
                                  title={`The resume parser couldn't find the following on this CV: ${(c.missing_fields ?? []).join(", ")}. Open the candidate and add them — outbound channels (email, WhatsApp, voice) need real contact info.`}
                                >
                                  ⚠ Missing: {(c.missing_fields ?? []).join(", ")}
                                </span>
                              )}
                              {(c.fraud_flags_count ?? 0) > 0 && (
                                <span
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${
                                    c.fraud_critical
                                      ? "bg-rose-100 text-rose-800 border-rose-300"
                                      : "bg-amber-50 text-amber-800 border-amber-200"
                                  }`}
                                  title={
                                    c.fraud_critical
                                      ? "Critical fraud signal detected (prompt injection, hidden text, invisible Unicode). Open the candidate to review."
                                      : `${c.fraud_flags_count} fraud signal${c.fraud_flags_count === 1 ? "" : "s"} detected on this CV.`
                                  }
                                >
                                  🚩 {c.fraud_critical
                                    ? "Fraud detected"
                                    : `${c.fraud_flags_count} flag${c.fraud_flags_count === 1 ? "" : "s"}`}
                                </span>
                              )}
                              {!c.profile?.extracted_at && (
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700"
                                  title="The AI hasn't extracted the role / skills / summary for this CV yet. Click Re-extract to retry."
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
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void openResumeView(c);
                              }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 font-medium"
                              title="Preview the extracted resume text"
                            >
                              👁 View
                            </button>
                          )}
                          {c.resume_blob_available && (
                            <a
                              href={apiUrl(`/candidates/${c.id}/resume/file`)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-medium"
                              title="Open the original CV file"
                            >
                              ⤓ Download CV
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void reExtractProfile(c.id);
                            }}
                            disabled={reExtractingId === c.id}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-medium disabled:opacity-60 ${
                              c.profile?.extracted_at
                                ? "bg-slate-100 text-slate-700 hover:bg-indigo-100 hover:text-indigo-700"
                                : "bg-amber-100 text-amber-800 hover:bg-amber-200"
                            }`}
                            title={
                              c.profile?.extracted_at
                                ? "Re-run AI extraction (e.g. after editing contact info, or if the existing tags look wrong)"
                                : "Run AI extraction — fills in role, skills, summary, key points"
                            }
                          >
                            {reExtractingId === c.id ? "Re-extracting…" : "↻ Re-extract"}
                          </button>
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

          {/* Pagination footer — only when there's more than one page. */}
          {total > perPage && (
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
              <span>
                Showing {(page - 1) * perPage + 1}–
                {Math.min(page * perPage, total)} of {total}
              </span>
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                  className="px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ← Prev
                </button>
                <span className="px-2 font-mono">
                  Page {page} / {Math.max(1, Math.ceil(total / perPage))}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setPage((p) =>
                      Math.min(Math.max(1, Math.ceil(total / perPage)), p + 1),
                    )
                  }
                  disabled={page >= Math.ceil(total / perPage) || loading}
                  className="px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next →
                </button>
              </div>
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

      {drawerCand && (
        <CandidateDetailDrawer
          candidateId={drawerCand.id}
          applicationId={drawerCand.first_application_id ?? null}
          onClose={() => setDrawerCand(null)}
          onChanged={() => {
            setRefreshKey((n) => n + 1);
          }}
        />
      )}

      {resumeView && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 px-4"
          onClick={() => setResumeView(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-3xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-3 border-b border-slate-200 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-slate-900 truncate">
                  {resumeView.name}
                </h2>
                <p className="text-xs text-slate-500 truncate">
                  {resumeView.filename || "(no filename)"}
                  {resumeView.cv_version > 1 ? ` · v${resumeView.cv_version}` : ""}
                </p>
              </div>
              {resumeView.resume_blob_available && (
                <a
                  href={apiUrl(`/candidates/${resumeView.candidate_id}/resume/file`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-medium"
                >
                  ⤓ Download original
                </a>
              )}
              <button
                type="button"
                onClick={() => {
                  if (resumeView) void reExtractProfile(resumeView.candidate_id);
                }}
                disabled={reExtractingId === resumeView.candidate_id}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-slate-100 text-slate-700 hover:bg-indigo-100 hover:text-indigo-700 text-xs font-medium disabled:opacity-60"
                title="Re-run AI extraction on this CV"
              >
                {reExtractingId === resumeView.candidate_id
                  ? "Re-extracting…"
                  : "↻ Re-extract"}
              </button>
              <button
                onClick={() => setResumeView(null)}
                className="text-slate-500 hover:text-slate-800 text-xl leading-none"
              >
                ✕
              </button>
            </div>
            {resumeView.loading ? (
              <div className="px-6 py-12 text-center text-sm text-slate-500">
                Loading resume…
              </div>
            ) : (
              <pre className="px-6 py-4 overflow-y-auto whitespace-pre-wrap text-xs font-mono text-slate-800 flex-1">
                {resumeView.resume_text || "(no extracted text)"}
              </pre>
            )}
          </div>
        </div>
      )}
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
  // Per-file progress tracking for bulk uploads. Lets HR watch every CV
  // tick through pending → parsing → done|failed without blocking on a
  // single blob request.
  const [perFile, setPerFile] = useState<Record<string, { status: "pending" | "parsing" | "done" | "failed"; message?: string }>>({});

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
        // Multi-file: fire one /upload per file sequentially so we get
        // per-file progress (each LLM call is 1-3 seconds; users want
        // to see the ticker tick, not a frozen spinner). We could
        // parallelise but ElevenLabs-style burst limits on Mistral get
        // grumpy past ~3 concurrent.
        const init: Record<string, { status: "pending" | "parsing" | "done" | "failed"; message?: string }> = {};
        for (const f of files) init[f.name] = { status: "pending" };
        setPerFile(init);

        const okResults: UploadedSummary[] = [];
        const failures: { filename: string; error: string }[] = [];

        for (const f of files) {
          setPerFile((prev) => ({ ...prev, [f.name]: { status: "parsing" } }));
          try {
            const fd = new FormData();
            fd.append("file", f);
            const res = await fetch(`${API_BASE}/candidates/upload`, {
              method: "POST",
              credentials: "include",
              body: fd,
            });
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              throw new Error(body.detail || `HTTP ${res.status}`);
            }
            const data = (await res.json()) as UploadedSummary;
            okResults.push(data);
            setPerFile((prev) => ({ ...prev, [f.name]: { status: "done" } }));
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Upload failed";
            failures.push({ filename: f.name, error: msg });
            setPerFile((prev) => ({
              ...prev,
              [f.name]: { status: "failed", message: msg },
            }));
          }
        }

        setResults(okResults);
        if (failures.length > 0) {
          setError(
            `${failures.length} file(s) failed: ${failures
              .map((e) => `${e.filename} (${e.error})`)
              .join(", ")}`,
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
              <ul className="mt-2 max-h-48 overflow-y-auto text-xs text-slate-600 space-y-1">
                {files.map((f, i) => {
                  const p = perFile[f.name];
                  const dot = p?.status === "done"
                    ? "bg-emerald-500"
                    : p?.status === "failed"
                    ? "bg-rose-500"
                    : p?.status === "parsing"
                    ? "bg-indigo-500 animate-pulse"
                    : "bg-slate-300";
                  const label = p?.status === "done"
                    ? "uploaded"
                    : p?.status === "failed"
                    ? (p.message || "failed").slice(0, 40)
                    : p?.status === "parsing"
                    ? "analyzing…"
                    : `${(f.size / 1024).toFixed(0)} KB`;
                  return (
                    <li key={i} className="flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
                      <span className="truncate flex-1">{f.name}</span>
                      <span
                        className={`text-[10px] flex-shrink-0 ${
                          p?.status === "failed"
                            ? "text-rose-600"
                            : p?.status === "done"
                            ? "text-emerald-700"
                            : "text-slate-500"
                        }`}
                      >
                        {label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {busy && files.length > 1 && (() => {
              const done = Object.values(perFile).filter(
                (p) => p.status === "done" || p.status === "failed",
              ).length;
              const pct = Math.round((done / files.length) * 100);
              return (
                <div className="mt-3">
                  <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                    <span>Processed {done} of {files.length}</span>
                    <span>{pct}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })()}
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
              {(() => {
                if (busy) {
                  if (files.length > 1) {
                    const done = Object.values(perFile).filter(
                      (p) => p.status === "done" || p.status === "failed",
                    ).length;
                    return `Processing ${done + 1}/${files.length}…`;
                  }
                  return "Analyzing…";
                }
                return files.length > 1
                  ? `Upload ${files.length} to talent bank`
                  : "Upload to talent bank";
              })()}
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
