"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowDownTrayIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  UserPlusIcon,
  FunnelIcon,
} from "@heroicons/react/24/outline";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import {
  PIPELINE_STAGES,
  STAGE_COLORS,
  STAGE_LABELS,
  RECOMMENDATION_COLORS,
  scoreColor,
  timeAgo,
} from "@/lib/constants";
import type {
  Application,
  ApplicationListResponse,
  Job,
  JobListResponse,
  Candidate,
} from "@/types/index";

// ── Types ────────────────────────────────────────────────────────────────────

interface CandidateListResponse {
  candidates: Candidate[];
  total: number;
}

type SortField = "candidate_name" | "resume_score" | "interview_score" | "updated_at";
type SortOrder = "asc" | "desc";

const PER_PAGE_OPTIONS = [10, 25, 50] as const;

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

// ── Page wrapper with Suspense (required by Next.js 15 for useSearchParams) ─

function CandidatesLoadingFallback() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="h-7 w-40 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-28 bg-slate-200 rounded animate-pulse mt-2" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-9 w-28 bg-slate-200 rounded-lg animate-pulse" />
          <div className="h-9 w-36 bg-slate-200 rounded-lg animate-pulse" />
        </div>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <div className="h-5 w-16 bg-slate-200 rounded animate-pulse mb-3" />
        <div className="flex gap-3">
          <div className="h-9 w-44 bg-slate-200 rounded-lg animate-pulse" />
          <div className="h-9 w-40 bg-slate-200 rounded-lg animate-pulse" />
          <div className="h-9 w-44 bg-slate-200 rounded-lg animate-pulse" />
          <div className="h-9 flex-1 bg-slate-200 rounded-lg animate-pulse" />
        </div>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CandidatesPage() {
  return (
    <Suspense fallback={<CandidatesLoadingFallback />}>
      <CandidatesTracker />
    </Suspense>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

function CandidatesTracker() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── Filter state (synced with URL) ──────────────────────────────────────
  const [jobFilter, setJobFilter] = useState(searchParams.get("job_id") || "");
  const [stageFilter, setStageFilter] = useState(searchParams.get("stage") || "");
  const [minScore, setMinScore] = useState(searchParams.get("min_score") || "");
  const [maxScore, setMaxScore] = useState(searchParams.get("max_score") || "");
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [sortBy, setSortBy] = useState<SortField>(
    (searchParams.get("sort_by") as SortField) || "updated_at"
  );
  const [order, setOrder] = useState<SortOrder>(
    (searchParams.get("order") as SortOrder) || "desc"
  );
  const [page, setPage] = useState(Number(searchParams.get("page")) || 1);
  const [perPage, setPerPage] = useState(
    Number(searchParams.get("per_page")) || 25
  );

  // ── Data state ──────────────────────────────────────────────────────────
  const [applications, setApplications] = useState<Application[]>([]);
  const [total, setTotal] = useState(0);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobsLoading, setJobsLoading] = useState(true);

  // ── Match dialog state ──────────────────────────────────────────────────
  const [matchOpen, setMatchOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [matchCandidateId, setMatchCandidateId] = useState("");
  const [matchJobId, setMatchJobId] = useState("");
  const [matchLoading, setMatchLoading] = useState(false);
  const [candidatesLoading, setCandidatesLoading] = useState(false);

  // ── Search debounce ─────────────────────────────────────────────────────
  const searchTimeout = useRef<NodeJS.Timeout | null>(null);
  const [searchInput, setSearchInput] = useState(search);

  // ── Sync URL params ─────────────────────────────────────────────────────
  const syncParams = useCallback(() => {
    const params = new URLSearchParams();
    if (jobFilter) params.set("job_id", jobFilter);
    if (stageFilter) params.set("stage", stageFilter);
    if (minScore) params.set("min_score", minScore);
    if (maxScore) params.set("max_score", maxScore);
    if (search) params.set("search", search);
    if (sortBy !== "updated_at") params.set("sort_by", sortBy);
    if (order !== "desc") params.set("order", order);
    if (page > 1) params.set("page", String(page));
    if (perPage !== 25) params.set("per_page", String(perPage));
    const qs = params.toString();
    router.replace(`/candidates${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [jobFilter, stageFilter, minScore, maxScore, search, sortBy, order, page, perPage, router]);

  useEffect(() => {
    syncParams();
  }, [syncParams]);

  // ── Fetch jobs for filter dropdown ──────────────────────────────────────
  useEffect(() => {
    setJobsLoading(true);
    apiGet<JobListResponse>("/jobs")
      .then((res) => setJobs(res.jobs))
      .catch(() => setJobs([]))
      .finally(() => setJobsLoading(false));
  }, []);

  // ── Fetch applications ─────────────────────────────────────────────────
  const fetchApplications = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page),
        per_page: String(perPage),
        sort_by: sortBy,
        order,
      };
      if (jobFilter) params.job_id = jobFilter;
      if (stageFilter) params.stage = stageFilter;
      if (minScore) params.min_score = minScore;
      if (maxScore) params.max_score = maxScore;
      if (search) params.search = search;

      const res = await apiGet<ApplicationListResponse>("/applications", params);
      setApplications(res.applications);
      setTotal(res.total);
    } catch {
      setApplications([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [jobFilter, stageFilter, minScore, maxScore, search, sortBy, order, page, perPage]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  // ── Debounced search ────────────────────────────────────────────────────
  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setSearch(value);
      setPage(1);
    }, 400);
  };

  // ── Sort handler ────────────────────────────────────────────────────────
  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setOrder("desc");
    }
    setPage(1);
  };

  // ── Stage inline edit ──────────────────────────────────────────────────
  const handleStageChange = async (appId: number, newStage: string) => {
    const prev = applications.find((a) => a.id === appId);
    if (!prev) return;

    // Optimistic update
    setApplications((apps) =>
      apps.map((a) => (a.id === appId ? { ...a, stage: newStage } : a))
    );

    try {
      await apiPatch(`/applications/${appId}/stage`, { stage: newStage });
    } catch {
      // Revert on error
      setApplications((apps) =>
        apps.map((a) => (a.id === appId ? { ...a, stage: prev.stage } : a))
      );
      alert("Failed to update stage. Please try again.");
    }
  };

  // ── CSV export ──────────────────────────────────────────────────────────
  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      if (jobFilter) params.set("job_id", jobFilter);
      if (stageFilter) params.set("stage", stageFilter);
      if (minScore) params.set("min_score", minScore);
      if (maxScore) params.set("max_score", maxScore);
      if (search) params.set("search", search);

      const qs = params.toString();
      const url = `${API_BASE}/applications/export/csv${qs ? `?${qs}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `candidates-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch {
      alert("Failed to export CSV. Please try again.");
    }
  };

  // ── Match candidate dialog ─────────────────────────────────────────────
  const openMatchDialog = async () => {
    setMatchOpen(true);
    setMatchCandidateId("");
    setMatchJobId("");
    setCandidatesLoading(true);
    try {
      const res = await apiGet<CandidateListResponse>("/candidates");
      setCandidates(res.candidates);
    } catch {
      setCandidates([]);
    } finally {
      setCandidatesLoading(false);
    }
  };

  const handleMatch = async () => {
    if (!matchCandidateId || !matchJobId) return;
    setMatchLoading(true);
    try {
      await apiPost("/applications/match", {
        candidate_id: Number(matchCandidateId),
        job_id: Number(matchJobId),
      });
      setMatchOpen(false);
      fetchApplications();
    } catch {
      alert("Failed to match candidate. Please try again.");
    } finally {
      setMatchLoading(false);
    }
  };

  // ── Clear all filters ──────────────────────────────────────────────────
  const clearFilters = () => {
    setJobFilter("");
    setStageFilter("");
    setMinScore("");
    setMaxScore("");
    setSearch("");
    setSearchInput("");
    setPage(1);
    setSortBy("updated_at");
    setOrder("desc");
  };

  const hasFilters = jobFilter || stageFilter || minScore || maxScore || search;

  // ── Pagination ─────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const renderSortIcon = (field: SortField) => {
    if (sortBy !== field) {
      return (
        <span className="ml-1 inline-flex flex-col text-slate-300">
          <ChevronUpIcon className="h-3 w-3 -mb-0.5" />
          <ChevronDownIcon className="h-3 w-3 -mt-0.5" />
        </span>
      );
    }
    return order === "asc" ? (
      <ChevronUpIcon className="ml-1 h-3.5 w-3.5 text-indigo-600" />
    ) : (
      <ChevronDownIcon className="ml-1 h-3.5 w-3.5 text-indigo-600" />
    );
  };

  // ── Score cell renderer ────────────────────────────────────────────────
  const renderScore = (score: number | null) => {
    if (score === null || score === undefined) {
      return <span className="text-slate-300 font-medium">--</span>;
    }
    return (
      <span className={`font-semibold tabular-nums ${scoreColor(score)}`}>
        {score}
      </span>
    );
  };

  // ── Recommendation badge ───────────────────────────────────────────────
  const renderRecommendation = (rec: string | null) => {
    if (!rec) return <span className="text-slate-300">--</span>;
    const colorClass = RECOMMENDATION_COLORS[rec] || "bg-slate-100 text-slate-600";
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${colorClass}`}
      >
        {rec}
      </span>
    );
  };

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-4">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Candidates</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {total} application{total !== 1 ? "s" : ""} tracked
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
          >
            <ArrowDownTrayIcon className="h-4 w-4" />
            Export CSV
          </button>
          <button
            onClick={openMatchDialog}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <UserPlusIcon className="h-4 w-4" />
            Match Candidate
          </button>
        </div>
      </div>

      {/* ── Filter Bar ──────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <FunnelIcon className="h-4 w-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-600">Filters</span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {/* Job filter */}
          <div className="flex flex-col gap-1 min-w-[180px]">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Job
            </label>
            <select
              value={jobFilter}
              onChange={(e) => {
                setJobFilter(e.target.value);
                setPage(1);
              }}
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">All Jobs</option>
              {jobsLoading ? (
                <option disabled>Loading...</option>
              ) : (
                jobs.map((j) => (
                  <option key={j.id} value={String(j.id)}>
                    {j.title} ({j.job_id})
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Stage filter */}
          <div className="flex flex-col gap-1 min-w-[160px]">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Stage
            </label>
            <select
              value={stageFilter}
              onChange={(e) => {
                setStageFilter(e.target.value);
                setPage(1);
              }}
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">All Stages</option>
              {PIPELINE_STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s] || s}
                </option>
              ))}
            </select>
          </div>

          {/* Score range */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Score Range
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                max={100}
                placeholder="Min"
                value={minScore}
                onChange={(e) => {
                  setMinScore(e.target.value);
                  setPage(1);
                }}
                className="w-20 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
              <span className="text-slate-400 text-sm">-</span>
              <input
                type="number"
                min={0}
                max={100}
                placeholder="Max"
                value={maxScore}
                onChange={(e) => {
                  setMaxScore(e.target.value);
                  setPage(1);
                }}
                className="w-20 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Search */}
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Search
            </label>
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Name or email..."
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="block w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Clear filters */}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <XMarkIcon className="h-4 w-4" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Main Table ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th
                  className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer select-none hover:text-indigo-600 transition-colors"
                  onClick={() => handleSort("candidate_name")}
                >
                  <span className="inline-flex items-center">
                    Name
                    {renderSortIcon("candidate_name")}
                  </span>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Job
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Stage
                </th>
                <th
                  className="px-4 py-3 text-center text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer select-none hover:text-indigo-600 transition-colors"
                  onClick={() => handleSort("resume_score")}
                >
                  <span className="inline-flex items-center justify-center">
                    Resume
                    {renderSortIcon("resume_score")}
                  </span>
                </th>
                <th
                  className="px-4 py-3 text-center text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer select-none hover:text-indigo-600 transition-colors"
                  onClick={() => handleSort("interview_score")}
                >
                  <span className="inline-flex items-center justify-center">
                    Interview
                    {renderSortIcon("interview_score")}
                  </span>
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Rec.
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Next Action
                </th>
                <th
                  className="px-4 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer select-none hover:text-indigo-600 transition-colors"
                  onClick={() => handleSort("updated_at")}
                >
                  <span className="inline-flex items-center justify-end">
                    Updated
                    {renderSortIcon("updated_at")}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                // Skeleton rows
                Array.from({ length: perPage > 10 ? 10 : perPage }).map((_, i) => (
                  <tr key={`skel-${i}`} className="animate-pulse">
                    <td className="px-4 py-3">
                      <div className="h-4 w-32 bg-slate-200 rounded" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 w-40 bg-slate-200 rounded" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-5 w-20 bg-slate-200 rounded-full" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-7 w-28 bg-slate-200 rounded" />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="h-4 w-8 bg-slate-200 rounded mx-auto" />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="h-4 w-8 bg-slate-200 rounded mx-auto" />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="h-5 w-16 bg-slate-200 rounded-full mx-auto" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 w-36 bg-slate-200 rounded" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 w-16 bg-slate-200 rounded ml-auto" />
                    </td>
                  </tr>
                ))
              ) : applications.length === 0 ? (
                // Empty state
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <MagnifyingGlassIcon className="h-10 w-10 text-slate-300" />
                      <p className="text-sm font-medium text-slate-500">
                        No candidates found.
                      </p>
                      <p className="text-xs text-slate-400">
                        Try adjusting your filters.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                // Data rows
                applications.map((app) => (
                  <tr
                    key={app.id}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    {/* Name */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link
                        href={`/candidates/${app.id}`}
                        className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 hover:underline transition-colors"
                      >
                        {app.candidate_name}
                      </Link>
                    </td>

                    {/* Email */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-sm text-slate-500">
                        {app.candidate_email}
                      </span>
                    </td>

                    {/* Job */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                        {app.job_code}
                      </span>
                    </td>

                    {/* Stage (inline select) */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <select
                        value={app.stage}
                        onChange={(e) => handleStageChange(app.id, e.target.value)}
                        className={`text-xs font-medium rounded-lg border-0 py-1 pl-2.5 pr-7 cursor-pointer focus:ring-2 focus:ring-indigo-500 ${
                          STAGE_COLORS[app.stage] || "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {PIPELINE_STAGES.map((s) => (
                          <option key={s} value={s}>
                            {STAGE_LABELS[s] || s}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Resume Score */}
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      {renderScore(app.resume_score)}
                    </td>

                    {/* Interview Score */}
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      {renderScore(app.interview_score)}
                    </td>

                    {/* Recommendation */}
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      {renderRecommendation(app.recommendation)}
                    </td>

                    {/* Next Action */}
                    <td className="px-4 py-3 whitespace-nowrap max-w-[200px]">
                      {app.ai_next_action ? (
                        <span
                          className="text-sm text-slate-600 truncate block"
                          title={app.ai_next_action}
                        >
                          {app.ai_next_action.length > 30
                            ? `${app.ai_next_action.slice(0, 30)}...`
                            : app.ai_next_action}
                        </span>
                      ) : (
                        <span className="text-slate-300 text-sm">--</span>
                      )}
                    </td>

                    {/* Updated */}
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <span className="text-xs text-slate-400">
                        {timeAgo(app.updated_at)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ──────────────────────────────────────────────── */}
        {!loading && total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50/50">
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-500">
                Showing{" "}
                <span className="font-medium text-slate-700">
                  {(page - 1) * perPage + 1}
                </span>
                {" - "}
                <span className="font-medium text-slate-700">
                  {Math.min(page * perPage, total)}
                </span>
                {" of "}
                <span className="font-medium text-slate-700">{total}</span>
              </span>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-slate-500">Per page:</label>
                <select
                  value={perPage}
                  onChange={(e) => {
                    setPerPage(Number(e.target.value));
                    setPage(1);
                  }}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                >
                  {PER_PAGE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                Prev
              </button>
              {/* Page numbers */}
              {generatePageNumbers(page, totalPages).map((p, idx) =>
                p === "..." ? (
                  <span
                    key={`ellipsis-${idx}`}
                    className="px-2 py-1.5 text-xs text-slate-400"
                  >
                    ...
                  </span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p as number)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors shadow-sm ${
                      page === p
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "text-slate-600 bg-white border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Match Candidate Dialog ─────────────────────────────────────── */}
      {matchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setMatchOpen(false)}
          />
          {/* Panel */}
          <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-slate-900">
                Match Candidate to Job
              </h2>
              <button
                onClick={() => setMatchOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <XMarkIcon className="h-5 w-5 text-slate-400" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Candidate select */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Candidate
                </label>
                <select
                  value={matchCandidateId}
                  onChange={(e) => setMatchCandidateId(e.target.value)}
                  className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">Select a candidate...</option>
                  {candidatesLoading ? (
                    <option disabled>Loading candidates...</option>
                  ) : (
                    candidates.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name} ({c.email})
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* Job select */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Job
                </label>
                <select
                  value={matchJobId}
                  onChange={(e) => setMatchJobId(e.target.value)}
                  className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">Select a job...</option>
                  {jobsLoading ? (
                    <option disabled>Loading jobs...</option>
                  ) : (
                    jobs.map((j) => (
                      <option key={j.id} value={String(j.id)}>
                        {j.title} ({j.job_id})
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => setMatchOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleMatch}
                disabled={!matchCandidateId || !matchJobId || matchLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                {matchLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <svg
                      className="animate-spin h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Matching...
                  </span>
                ) : (
                  "Match & Score"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generatePageNumbers(
  current: number,
  total: number
): (number | "...")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | "...")[] = [];

  // Always show first page
  pages.push(1);

  if (current > 3) {
    pages.push("...");
  }

  // Pages around current
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 2) {
    pages.push("...");
  }

  // Always show last page
  if (total > 1) {
    pages.push(total);
  }

  return pages;
}
