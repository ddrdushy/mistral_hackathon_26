"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  DocumentTextIcon,
  ChartBarIcon,
  StarIcon,
  XCircleIcon,
  TrophyIcon,
} from "@heroicons/react/24/outline";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

import { apiGet } from "@/lib/api";
import {
  ReportSummary,
  FunnelStage,
  TopCandidate,
  JobListResponse,
} from "@/types/index";
import {
  STAGE_LABELS,
  STAGE_COLORS,
  RECOMMENDATION_COLORS,
  scoreColor,
} from "@/lib/constants";
import MetricCard from "@/components/ui/MetricCard";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import Select from "@/components/ui/Select";

/* ------------------------------------------------------------------ */
/*  Funnel bar colors per stage                                        */
/* ------------------------------------------------------------------ */
const FUNNEL_COLORS: Record<string, string> = {
  new: "#3b82f6",
  classified: "#6366f1",
  matched: "#a855f7",
  screening_scheduled: "#eab308",
  screened: "#f97316",
  shortlisted: "#22c55e",
  rejected: "#ef4444",
};

/* ------------------------------------------------------------------ */
/*  Score distribution bucket colors                                   */
/* ------------------------------------------------------------------ */
const SCORE_BUCKETS = [
  { label: "Low (0-40)", min: 0, max: 40, color: "#ef4444" },
  { label: "Medium (40-70)", min: 40, max: 70, color: "#eab308" },
  { label: "High (70-100)", min: 70, max: 100, color: "#22c55e" },
];

/* ------------------------------------------------------------------ */
/*  Map recommendation to Badge variant                                */
/* ------------------------------------------------------------------ */
function recBadgeVariant(rec: string | null) {
  if (!rec) return "default" as const;
  if (rec === "advance") return "success" as const;
  if (rec === "hold") return "warning" as const;
  if (rec === "reject") return "danger" as const;
  return "default" as const;
}

/* ------------------------------------------------------------------ */
/*  Map stage to Badge variant                                         */
/* ------------------------------------------------------------------ */
function stageBadgeVariant(stage: string) {
  if (stage === "shortlisted") return "success" as const;
  if (stage === "rejected") return "danger" as const;
  if (stage === "screening_scheduled" || stage === "screened")
    return "warning" as const;
  if (stage === "matched" || stage === "classified") return "info" as const;
  return "default" as const;
}

/* ================================================================== */
/*  Reports Page                                                       */
/* ================================================================== */
export default function ReportsPage() {
  const router = useRouter();

  /* ---- State ---- */
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [funnel, setFunnel] = useState<FunnelStage[]>([]);
  const [topCandidates, setTopCandidates] = useState<TopCandidate[]>([]);
  const [jobs, setJobs] = useState<{ value: string; label: string }[]>([]);
  const [selectedJob, setSelectedJob] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ---- Fetch jobs list for filter dropdown ---- */
  useEffect(() => {
    async function loadJobs() {
      try {
        const data = await apiGet<JobListResponse>("/jobs");
        const options = [
          { value: "", label: "All Jobs" },
          ...data.jobs.map((j) => ({
            value: String(j.id),
            label: j.title,
          })),
        ];
        setJobs(options);
      } catch {
        // Silently fall back to no filter
      }
    }
    loadJobs();
  }, []);

  /* ---- Fetch report data (re-runs when job filter changes) ---- */
  const fetchReports = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params: Record<string, string> = {};
      if (selectedJob) params.job_id = selectedJob;

      const [summaryData, funnelData, candidatesData] = await Promise.all([
        apiGet<ReportSummary>("/reports/summary", params),
        apiGet<{ funnel: FunnelStage[] }>("/reports/funnel", params),
        apiGet<{ candidates: TopCandidate[] }>("/reports/top-candidates", {
          ...params,
          limit: "10",
        }),
      ]);

      setSummary(summaryData);
      setFunnel(funnelData.funnel ?? []);
      setTopCandidates(candidatesData.candidates ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load report data"
      );
    } finally {
      setLoading(false);
    }
  }, [selectedJob]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  /* ---- Prepare funnel chart data ---- */
  const funnelChartData = funnel.map((s) => ({
    stage: STAGE_LABELS[s.stage] || s.stage,
    count: s.count,
    percentage: s.percentage,
    rawStage: s.stage,
  }));

  /* ---- Prepare score distribution data ---- */
  const scoreDistribution = SCORE_BUCKETS.map((bucket) => {
    const count = topCandidates.filter(
      (c) =>
        c.combined_score >= bucket.min &&
        (bucket.max === 100
          ? c.combined_score <= bucket.max
          : c.combined_score < bucket.max)
    ).length;
    return { ...bucket, count };
  });

  /* ---- Error state ---- */
  if (error && !summary) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-slate-900">Reports</h1>
        <EmptyState
          icon={<ChartBarIcon />}
          title="Failed to load reports"
          description={error}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ---- Header with job filter ---- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">Reports</h1>
        <Select
          value={selectedJob}
          onChange={setSelectedJob}
          options={jobs}
          placeholder="Filter by job..."
          className="w-full sm:w-64"
        />
      </div>

      {/* ---- Loading state ---- */}
      {loading ? (
        <div className="flex items-center justify-center py-32">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <>
          {/* ═══════════════════════════════════════════════════════ */}
          {/* ROW 1 : Summary Metric Cards                           */}
          {/* ═══════════════════════════════════════════════════════ */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Total Applications"
              value={summary?.total_applications ?? 0}
              icon={<DocumentTextIcon />}
            />
            <MetricCard
              title="Avg Resume Score"
              value={
                summary?.avg_resume_score != null
                  ? `${Math.round(summary.avg_resume_score)}`
                  : "--"
              }
              icon={<StarIcon />}
            />
            <MetricCard
              title="Shortlisted"
              value={summary?.shortlisted_count ?? 0}
              icon={<TrophyIcon />}
            />
            <MetricCard
              title="Rejected"
              value={summary?.rejected_count ?? 0}
              icon={<XCircleIcon />}
            />
          </div>

          {/* ═══════════════════════════════════════════════════════ */}
          {/* ROW 2 : Pipeline Funnel                                */}
          {/* ═══════════════════════════════════════════════════════ */}
          <Card title="Pipeline Funnel">
            {funnelChartData.length === 0 ? (
              <EmptyState
                icon={<ChartBarIcon />}
                title="No funnel data"
                description="Funnel data will appear once candidates move through the pipeline."
              />
            ) : (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={funnelChartData}
                    layout="vertical"
                    margin={{ top: 5, right: 40, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#e2e8f0"
                    />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 12, fill: "#64748b" }}
                    />
                    <YAxis
                      type="category"
                      dataKey="stage"
                      width={100}
                      tick={{ fontSize: 12, fill: "#64748b" }}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: "8px",
                        border: "1px solid #e2e8f0",
                        boxShadow:
                          "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                      }}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={(value: any, _name: any, props: any) => {
                        const v = value ?? 0;
                        const pct = props?.payload?.percentage;
                        return [
                          `${v}${pct != null ? ` (${pct}%)` : ""}`,
                          "Applications",
                        ];
                      }}
                    />
                    <Bar
                      dataKey="count"
                      radius={[0, 4, 4, 0]}
                      barSize={28}
                      label={{
                        position: "right",
                        formatter: (value: unknown) => String(value ?? ""),
                        fontSize: 12,
                        fill: "#64748b",
                      }}
                    >
                      {funnelChartData.map((entry, index) => (
                        <Cell
                          key={`funnel-${index}`}
                          fill={
                            FUNNEL_COLORS[entry.rawStage] ||
                            "#94a3b8"
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* ═══════════════════════════════════════════════════════ */}
          {/* ROW 3 : Top Candidates Table                           */}
          {/* ═══════════════════════════════════════════════════════ */}
          <Card title="Top Candidates">
            {topCandidates.length === 0 ? (
              <EmptyState
                icon={<TrophyIcon />}
                title="No candidates yet"
                description="Top candidates will appear once applications are scored."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      {[
                        "#",
                        "Name",
                        "Job",
                        "Resume",
                        "Interview",
                        "Combined",
                        "Recommendation",
                        "Stage",
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {topCandidates.map((c, idx) => (
                      <tr
                        key={c.candidate_id}
                        onClick={() =>
                          router.push(`/candidates/${c.candidate_id}`)
                        }
                        className={`cursor-pointer hover:bg-blue-50/40 transition-colors ${
                          idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"
                        }`}
                      >
                        <td className="px-4 py-3.5 text-sm font-medium text-slate-500">
                          {idx + 1}
                        </td>
                        <td className="px-4 py-3.5 text-sm font-medium text-slate-900">
                          {c.candidate_name}
                        </td>
                        <td className="px-4 py-3.5 text-sm text-slate-600">
                          {c.job_title}
                        </td>
                        <td className="px-4 py-3.5 text-sm">
                          <span
                            className={`font-semibold ${scoreColor(
                              c.resume_score
                            )}`}
                          >
                            {c.resume_score ?? "--"}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-sm">
                          <span
                            className={`font-semibold ${scoreColor(
                              c.interview_score
                            )}`}
                          >
                            {c.interview_score ?? "--"}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-sm">
                          <span
                            className={`font-bold ${scoreColor(
                              c.combined_score
                            )}`}
                          >
                            {c.combined_score}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-sm">
                          <Badge variant={recBadgeVariant(c.recommendation)}>
                            {c.recommendation
                              ? c.recommendation.charAt(0).toUpperCase() +
                                c.recommendation.slice(1)
                              : "--"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3.5 text-sm">
                          <Badge variant={stageBadgeVariant(c.stage)} size="sm">
                            {STAGE_LABELS[c.stage] || c.stage}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* ═══════════════════════════════════════════════════════ */}
          {/* ROW 4 : Score Distribution                             */}
          {/* ═══════════════════════════════════════════════════════ */}
          <Card title="Score Distribution">
            {topCandidates.length === 0 ? (
              <p className="text-sm text-slate-500">
                No score data available yet.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {scoreDistribution.map((bucket) => (
                  <div
                    key={bucket.label}
                    className="flex items-center gap-4 p-4 rounded-lg border border-slate-200"
                  >
                    <div
                      className="flex-shrink-0 h-12 w-12 rounded-full flex items-center justify-center text-white font-bold text-lg"
                      style={{ backgroundColor: bucket.color }}
                    >
                      {bucket.count}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        {bucket.label}
                      </p>
                      <p className="text-xs text-slate-500">
                        {topCandidates.length > 0
                          ? `${Math.round(
                              (bucket.count / topCandidates.length) * 100
                            )}% of top candidates`
                          : "No data"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
