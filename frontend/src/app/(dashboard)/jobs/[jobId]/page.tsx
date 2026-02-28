"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { apiGet, apiDelete } from "@/lib/api";
import { timeAgo, STAGE_COLORS, STAGE_LABELS } from "@/lib/constants";
import type { Job, Application, ApplicationListResponse } from "@/types/index";

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
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center px-3 py-2 text-sm font-medium rounded-lg text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
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
