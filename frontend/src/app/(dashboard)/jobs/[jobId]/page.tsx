"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { apiGet, apiPut, apiDelete } from "@/lib/api";
import { timeAgo, STAGE_COLORS, STAGE_LABELS } from "@/lib/constants";
import type { Job, Application, ApplicationListResponse } from "@/types/index";
import TalentSearchPanel from "@/components/talent/TalentSearchPanel";
import InterviewQuestionsEditor from "@/components/jobs/InterviewQuestionsEditor";
import PipelineForecastCard from "@/components/forecasts/PipelineForecastCard";
import JobBoardPublishCard from "@/components/jobs/JobBoardPublishCard";

const STATUS_BADGE: Record<string, string> = {
  open: "bg-green-100 text-green-800",
  closed: "bg-gray-100 text-gray-700",
  paused: "bg-yellow-100 text-yellow-800",
};

const SKILL_COLORS = [
  "bg-blue-100 text-blue-700",
  "bg-purple-100 text-purple-700",
  "bg-pink-100 text-pink-700",
  "bg-teal-100 text-teal-700",
  "bg-orange-100 text-orange-700",
  "bg-cyan-100 text-cyan-700",
  "bg-rose-100 text-rose-700",
  "bg-emerald-100 text-emerald-700",
];

function skillColor(index: number): string {
  return SKILL_COLORS[index % SKILL_COLORS.length];
}

interface TalentBankSuggestion {
  candidate_id: number;
  name: string;
  email: string;
  role: string;
  seniority: string;
  years_experience: number | null;
  summary: string;
  skills: string[];
  matched_skills: string[];
  match_score: number;
}

interface TalentBankResponse {
  job_id: number;
  job_skills: string[];
  suggestions: TalentBankSuggestion[];
  total_profiled: number;
  total_candidates: number;
}

function TalentBankSuggestions({ jobId }: { jobId: string }) {
  const [data, setData] = useState<TalentBankResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiGet<TalentBankResponse>(
          `/jobs/${jobId}/suggested-candidates?limit=10`,
        );
        if (!cancelled) setData(res);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="h-5 w-48 bg-slate-200 rounded animate-pulse mb-3" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const empty = data.suggestions.length === 0;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            From your talent bank
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Past candidates whose profile tags match this role —{" "}
            {data.total_profiled} of {data.total_candidates} profiled
          </p>
        </div>
      </div>

      {empty ? (
        <p className="text-sm text-slate-500">
          No matching profiles yet. As resumes come in, they&apos;re tagged
          automatically and surface here for future jobs.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.suggestions.map((s) => (
            <li key={s.candidate_id} className="py-3 flex items-start gap-4">
              <div className="flex-shrink-0 w-12 text-center">
                <div className="text-base font-bold text-indigo-600 tabular-nums">
                  {s.match_score}
                </div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">
                  match
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href={`/candidates/${s.candidate_id}`}
                    className="text-sm font-semibold text-slate-900 hover:text-indigo-700"
                  >
                    {s.name}
                  </a>
                  {s.role && (
                    <span className="text-xs text-slate-500">· {s.role}</span>
                  )}
                  {s.seniority && s.seniority !== "unknown" && (
                    <span className="text-[11px] uppercase tracking-wide text-slate-400">
                      · {s.seniority}
                    </span>
                  )}
                  {s.years_experience != null && s.years_experience > 0 && (
                    <span className="text-xs text-slate-500">
                      · {s.years_experience}y
                    </span>
                  )}
                </div>
                {s.summary && (
                  <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                    {s.summary}
                  </p>
                )}
                {s.matched_skills.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {s.matched_skills.slice(0, 8).map((sk) => (
                      <span
                        key={sk}
                        className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200"
                      >
                        {sk}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function JobDetailPage() {
  const router = useRouter();
  const params = useParams();
  const jobId = params.jobId as string;

  const [job, setJob] = useState<Job | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [appsLoading, setAppsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    async function fetchJob() {
      setLoading(true);
      try {
        const data = await apiGet<Job>(`/jobs/${jobId}`);
        setJob(data);
      } catch {
        setError("Failed to load job details");
      } finally {
        setLoading(false);
      }
    }
    fetchJob();
  }, [jobId]);

  useEffect(() => {
    async function fetchApplications() {
      setAppsLoading(true);
      try {
        const data = await apiGet<ApplicationListResponse>("/applications", {
          job_id: jobId,
        });
        setApplications(data.applications);
      } catch {
        // Applications may not exist yet, that's fine
      } finally {
        setAppsLoading(false);
      }
    }
    fetchApplications();
  }, [jobId]);

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this job? This action cannot be undone.")) {
      return;
    }
    setDeleting(true);
    try {
      await apiDelete(`/jobs/${jobId}`);
      showToast("Job deleted successfully");
      router.push("/jobs");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete job";
      showToast(message, "error");
      setDeleting(false);
    }
  };

  const handleStatusChange = async (nextStatus: "open" | "closed") => {
    if (!job) return;
    const verb = nextStatus === "closed" ? "Close" : "Reopen";
    if (
      nextStatus === "closed" &&
      !confirm(
        "Close this job? It will be hidden from the default list and no new applications will auto-match to it. You can reopen it any time.",
      )
    ) {
      return;
    }
    setStatusUpdating(true);
    try {
      const updated = await apiPut<Job>(`/jobs/${jobId}`, { status: nextStatus });
      setJob(updated);
      showToast(`${verb}d successfully`);
    } catch (err) {
      const message = err instanceof Error ? err.message : `Failed to ${verb.toLowerCase()} job`;
      showToast(message, "error");
    } finally {
      setStatusUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-16">
        <svg className="animate-spin h-8 w-8 text-indigo-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-slate-500">Loading job details...</p>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
        <svg className="mx-auto h-12 w-12 text-red-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <h3 className="text-sm font-medium text-slate-900 mb-1">Error loading job</h3>
        <p className="text-sm text-slate-500 mb-4">{error || "Job not found"}</p>
        <button
          onClick={() => router.push("/jobs")}
          className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors"
        >
          Back to Jobs
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Toast notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all ${
            toast.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Back button */}
      <button
        onClick={() => router.push("/jobs")}
        className="inline-flex items-center text-sm text-slate-500 hover:text-slate-700 mb-4 transition-colors"
      >
        <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Jobs
      </button>

      {/* Job Header Card */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-semibold text-slate-900">{job.title}</h1>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  STATUS_BADGE[job.status] || "bg-gray-100 text-gray-700"
                }`}
              >
                {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500">
              <span className="font-mono text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                {job.job_id}
              </span>
              {job.department && (
                <span className="inline-flex items-center">
                  <svg className="w-4 h-4 mr-1 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  {job.department}
                </span>
              )}
              {job.location && (
                <span className="inline-flex items-center">
                  <svg className="w-4 h-4 mr-1 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {job.location}
                </span>
              )}
              {job.seniority && (
                <span className="inline-flex items-center">
                  <svg className="w-4 h-4 mr-1 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                  {job.seniority.charAt(0).toUpperCase() + job.seniority.slice(1)}
                </span>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => router.push(`/jobs/${jobId}/edit`)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit
            </button>
            {job.status === "open" ? (
              <button
                onClick={() => handleStatusChange("closed")}
                disabled={statusUpdating}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg text-amber-800 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 12H6" />
                </svg>
                {statusUpdating ? "Closing..." : "Close job"}
              </button>
            ) : (
              <button
                onClick={() => handleStatusChange("open")}
                disabled={statusUpdating}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m6-6H6" />
                </svg>
                {statusUpdating ? "Reopening..." : "Reopen job"}
              </button>
            )}
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center px-3 py-2 text-sm font-medium rounded-lg text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>

        {/* Expiry banner — appears when expires_at is set */}
        {job.expires_at && (
          <div
            className={`mt-3 inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-xs font-medium ${
              job.is_expired
                ? "bg-rose-50 text-rose-700 border border-rose-200"
                : "bg-slate-50 text-slate-600 border border-slate-200"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {job.is_expired
              ? `Expired on ${new Date(job.expires_at).toLocaleDateString()} — auto-pipeline skips this job`
              : `Expires on ${new Date(job.expires_at).toLocaleDateString()}`}
          </div>
        )}
      </div>

      {/* Skills Section */}
      {job.skills && job.skills.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-3">Skills</h2>
          <div className="flex flex-wrap gap-2">
            {job.skills.map((skill, idx) => (
              <span
                key={skill}
                className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${skillColor(idx)}`}
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Responsibilities Section */}
      {job.responsibilities && job.responsibilities.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-3">Responsibilities</h2>
          <ul className="space-y-2">
            {job.responsibilities.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2.5">
                <span className="text-indigo-400 mt-0.5 flex-shrink-0">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </span>
                <span className="text-sm text-slate-700 leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Qualifications Section */}
      {job.qualifications && job.qualifications.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-3">Qualifications</h2>
          <ul className="space-y-2">
            {job.qualifications.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2.5">
                <span className="text-emerald-500 mt-0.5 flex-shrink-0">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <span className="text-sm text-slate-700 leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Description Section */}
      {job.description && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-3">Description</h2>
          <div className="prose prose-slate prose-sm max-w-none">
            {job.description.split("\n").map((paragraph, idx) => (
              <p key={idx} className="text-sm text-slate-700 leading-relaxed mb-2">
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Multi-poster — push this job to LinkedIn / Indeed / FB /
          MyFutureJobs / etc. in one click. Connections are configured
          tenant-wide at /settings/job-boards. */}
      <div className="mb-6">
        <JobBoardPublishCard jobId={Number(jobId)} />
      </div>

      {/* Pipeline forecast (Feature 8) */}
      <div className="mb-6">
        <PipelineForecastCard jobId={Number(jobId)} title="Job forecast" />
      </div>

      {/* Custom interview questions (Feature 4) */}
      <div className="mb-6">
        <InterviewQuestionsEditor jobId={jobId} />
      </div>

      {/* From your talent bank — past resumes that match this job */}
      <TalentBankSuggestions jobId={jobId} />

      {/* AI Talent Search — source candidates without waiting for inbound applications */}
      <div className="mb-6">
        <TalentSearchPanel jobId={jobId} onShowToast={showToast} />
      </div>

      {/* Candidates / Applications Section */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider">
            Candidates ({applications.length})
          </h2>
        </div>

        {appsLoading ? (
          <div className="p-12 text-center">
            <svg className="animate-spin h-6 w-6 text-indigo-600 mx-auto mb-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm text-slate-500">Loading applications...</p>
          </div>
        ) : applications.length === 0 ? (
          <div className="p-12 text-center">
            <svg className="mx-auto h-10 w-10 text-slate-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <h3 className="text-sm font-medium text-slate-900 mb-1">No candidates yet</h3>
            <p className="text-sm text-slate-500">
              Candidates will appear here once they apply or are matched to this job.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">Candidate</th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">Stage</th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">Resume Score</th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">Interview Score</th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">Recommendation</th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">Applied</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {applications.map((app) => {
                  const stageColor = STAGE_COLORS[app.stage] || "bg-gray-100 text-gray-700";
                  const stageLabel = STAGE_LABELS[app.stage] || app.stage;

                  return (
                    <tr
                      key={app.id}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                      onClick={() => router.push(`/candidates/${app.candidate_id}`)}
                    >
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-slate-900">{app.candidate_name}</div>
                        <div className="text-xs text-slate-500">{app.candidate_email}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${stageColor}`}>
                          {stageLabel}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {app.resume_score !== null ? (
                          <span className={`text-sm font-semibold ${
                            app.resume_score >= 70 ? "text-green-600" : app.resume_score >= 50 ? "text-yellow-600" : "text-red-600"
                          }`}>
                            {app.resume_score}
                          </span>
                        ) : (
                          <span className="text-sm text-slate-400">--</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {app.interview_score !== null ? (
                          <span className={`text-sm font-semibold ${
                            app.interview_score >= 70 ? "text-green-600" : app.interview_score >= 50 ? "text-yellow-600" : "text-red-600"
                          }`}>
                            {app.interview_score}
                          </span>
                        ) : (
                          <span className="text-sm text-slate-400">--</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {app.recommendation ? (
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            app.recommendation === "advance"
                              ? "bg-green-100 text-green-800"
                              : app.recommendation === "hold"
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-red-100 text-red-800"
                          }`}>
                            {app.recommendation.charAt(0).toUpperCase() + app.recommendation.slice(1)}
                          </span>
                        ) : (
                          <span className="text-sm text-slate-400">--</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-slate-500">{timeAgo(app.created_at)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
