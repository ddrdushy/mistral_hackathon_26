"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowPathIcon,
  BellAlertIcon,
  BriefcaseIcon,
  ChartBarIcon,
  CheckCircleIcon,
  InboxIcon,
  PhoneIcon,
  PlusCircleIcon,
  SparklesIcon,
  StarIcon,
  TrophyIcon,
  UserGroupIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { apiGet } from "@/lib/api";
import {
  ActivityEvent,
  Application,
  ApplicationListResponse,
  Job,
  JobListResponse,
  ReportSummary,
  TopCandidate,
} from "@/types/index";
import { STAGE_LABELS, scoreColor, timeAgo } from "@/lib/constants";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import MetricCard from "@/components/ui/MetricCard";

const STAGE_BAR_COLORS: Record<string, string> = {
  new: "#3b82f6",
  classified: "#6366f1",
  matched: "#a855f7",
  interview_link_sent: "#06b6d4",
  screening_scheduled: "#eab308",
  screened: "#f97316",
  shortlisted: "#22c55e",
  rejected: "#ef4444",
};

const DECISION_COLORS = {
  shortlisted: "#22c55e",
  in_progress: "#3b82f6",
  rejected: "#ef4444",
};

function eventBadgeVariant(eventType: string) {
  if (eventType.includes("shortlist") || eventType.includes("advance"))
    return "success" as const;
  if (eventType.includes("reject")) return "danger" as const;
  if (eventType.includes("screen") || eventType.includes("interview"))
    return "warning" as const;
  if (eventType.includes("match") || eventType.includes("classif"))
    return "info" as const;
  return "default" as const;
}

function eventLabel(eventType: string): string {
  return eventType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function eventDescription(payload: Record<string, unknown>): string {
  if (typeof payload.description === "string") return payload.description;
  if (typeof payload.job_title === "string") return `Job: ${payload.job_title}`;
  if (typeof payload.stage === "string")
    return `Stage: ${STAGE_LABELS[payload.stage] || payload.stage}`;
  const keys = Object.keys(payload);
  if (keys.length === 0) return "";
  const first = payload[keys[0]];
  return typeof first === "string" ? first : "";
}

function recommendationVariant(
  rec: string | null,
): "success" | "warning" | "danger" | "default" {
  if (!rec) return "default";
  if (rec === "advance") return "success";
  if (rec === "hold") return "warning";
  if (rec === "reject") return "danger";
  return "default";
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [needsAction, setNeedsAction] = useState<Application[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      const [summaryData, activityData, appsData, jobsData] = await Promise.all([
        apiGet<ReportSummary>("/reports/summary"),
        apiGet<{ activity: ActivityEvent[] }>("/reports/activity"),
        apiGet<ApplicationListResponse>("/applications", {
          per_page: "50",
          sort_by: "updated_at",
          order: "desc",
        }),
        apiGet<JobListResponse>("/jobs", { per_page: "20" }),
      ]);
      setSummary(summaryData);
      setActivity(activityData.activity?.slice(0, 8) ?? []);
      const holds = (appsData.applications ?? []).filter(
        (a) => a.recommendation === "hold",
      );
      setNeedsAction(holds.slice(0, 6));
      const sortedJobs = [...(jobsData.jobs ?? [])].sort(
        (a, b) => (b.candidate_count ?? 0) - (a.candidate_count ?? 0),
      );
      setJobs(sortedJobs.slice(0, 6));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load dashboard data",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<ChartBarIcon />}
        title="Failed to load dashboard"
        description={error}
      />
    );
  }

  const totalApps = summary?.total_applications ?? 0;
  const shortlisted = summary?.shortlisted_count ?? 0;
  const rejected = summary?.rejected_count ?? 0;
  const inProgress = Math.max(0, totalApps - shortlisted - rejected);
  const shortlistRate =
    totalApps > 0 ? Math.round((shortlisted / totalApps) * 100) : 0;
  const rejectionRate =
    totalApps > 0 ? Math.round((rejected / totalApps) * 100) : 0;
  const avgScore = summary?.avg_resume_score ?? 0;

  const pipelineData = (summary?.stage_distribution ?? []).map((s) => ({
    stage: STAGE_LABELS[s.stage] || s.stage,
    count: s.count,
    percentage: s.percentage,
    rawStage: s.stage,
  }));

  const decisionData = [
    { name: "Shortlisted", value: shortlisted, color: DECISION_COLORS.shortlisted },
    { name: "In Progress", value: inProgress, color: DECISION_COLORS.in_progress },
    { name: "Rejected", value: rejected, color: DECISION_COLORS.rejected },
  ].filter((d) => d.value > 0);

  const topCandidates: TopCandidate[] = summary?.top_candidates ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Hiring pipeline overview and live activity
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          <ArrowPathIcon
            className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      {/* Row 1: KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Applications"
          value={totalApps}
          icon={<UsersIcon />}
          change={`${summary?.total_candidates ?? 0} candidates`}
          trend="neutral"
        />
        <MetricCard
          title="Avg Resume Score"
          value={avgScore > 0 ? `${avgScore}` : "—"}
          icon={<SparklesIcon />}
          change={avgScore >= 70 ? "strong" : avgScore >= 50 ? "fair" : avgScore > 0 ? "weak" : ""}
          trend={avgScore >= 70 ? "up" : avgScore >= 50 ? "neutral" : avgScore > 0 ? "down" : "neutral"}
        />
        <MetricCard
          title="Active Screenings"
          value={summary?.active_screenings ?? 0}
          icon={<PhoneIcon />}
          change={`${summary?.total_jobs ?? 0} open jobs`}
          trend="neutral"
        />
        <MetricCard
          title="Shortlisted"
          value={shortlisted}
          icon={<CheckCircleIcon />}
          change={totalApps > 0 ? `${shortlistRate}% conversion` : ""}
          trend={shortlistRate >= 20 ? "up" : shortlistRate > 0 ? "neutral" : "neutral"}
        />
      </div>

      {/* Row 2: Pipeline funnel + Decisions donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card title="Pipeline Funnel">
            {pipelineData.length === 0 || totalApps === 0 ? (
              <EmptyState
                icon={<ChartBarIcon />}
                title="No pipeline data"
                description="Pipeline data will appear once candidates are processed."
              />
            ) : (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={pipelineData}
                    layout="vertical"
                    margin={{ top: 5, right: 40, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#e2e8f0"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 12, fill: "#64748b" }}
                      allowDecimals={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="stage"
                      width={130}
                      tick={{ fontSize: 12, fill: "#475569" }}
                    />
                    <Tooltip
                      cursor={{ fill: "#f1f5f9" }}
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid #e2e8f0",
                        boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                        fontSize: 12,
                      }}
                      formatter={(value, _name, ctx) => [
                        `${value ?? 0} (${ctx?.payload?.percentage ?? 0}%)`,
                        "Applications",
                      ]}
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={24}>
                      {pipelineData.map((d) => (
                        <Cell
                          key={d.rawStage}
                          fill={STAGE_BAR_COLORS[d.rawStage] || "#94a3b8"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </div>

        <div className="lg:col-span-1">
          <Card title="Decisions">
            {decisionData.length === 0 ? (
              <EmptyState
                icon={<TrophyIcon />}
                title="No decisions yet"
                description="Outcomes will show here once candidates are shortlisted or rejected."
              />
            ) : (
              <>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={decisionData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={2}
                      >
                        {decisionData.map((d) => (
                          <Cell key={d.name} fill={d.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          borderRadius: 8,
                          border: "1px solid #e2e8f0",
                          fontSize: 12,
                        }}
                      />
                      <Legend
                        verticalAlign="bottom"
                        iconType="circle"
                        wrapperStyle={{ fontSize: 12 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-2 pt-4 border-t border-slate-100">
                  <div>
                    <p className="text-xs text-slate-500">Shortlist rate</p>
                    <p className="text-lg font-semibold text-emerald-600">
                      {shortlistRate}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Rejection rate</p>
                    <p className="text-lg font-semibold text-red-600">
                      {rejectionRate}%
                    </p>
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>

      {/* Row 3: Top Candidates + Needs Action */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card
            title="Top Candidates"
            action={
              <Link
                href="/candidates"
                className="text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                View all →
              </Link>
            }
          >
            {topCandidates.length === 0 ? (
              <EmptyState
                icon={<StarIcon />}
                title="No scored candidates yet"
                description="Top candidates will appear once resumes are scored."
              />
            ) : (
              <div className="overflow-x-auto -mx-6">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100">
                      <th className="text-left font-medium px-6 py-2 w-8">#</th>
                      <th className="text-left font-medium px-3 py-2">Candidate</th>
                      <th className="text-left font-medium px-3 py-2">Job</th>
                      <th className="text-right font-medium px-3 py-2">Resume</th>
                      <th className="text-right font-medium px-3 py-2">Interview</th>
                      <th className="text-left font-medium px-3 py-2">Recommendation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCandidates.map((c, i) => (
                      <tr
                        key={c.candidate_id}
                        className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60"
                      >
                        <td className="px-6 py-3 text-slate-400 font-medium">
                          {i + 1}
                        </td>
                        <td className="px-3 py-3">
                          <Link
                            href={`/candidates/${c.candidate_id}`}
                            className="font-medium text-slate-900 hover:text-blue-600"
                          >
                            {c.candidate_name || "Unnamed"}
                          </Link>
                          <p className="text-xs text-slate-500 truncate max-w-[220px]">
                            {c.candidate_email}
                          </p>
                        </td>
                        <td className="px-3 py-3 text-slate-600">
                          {c.job_title || "—"}
                        </td>
                        <td
                          className={`px-3 py-3 text-right font-semibold ${scoreColor(
                            c.resume_score,
                          )}`}
                        >
                          {c.resume_score ?? "—"}
                        </td>
                        <td
                          className={`px-3 py-3 text-right font-semibold ${scoreColor(
                            c.interview_score,
                          )}`}
                        >
                          {c.interview_score ?? "—"}
                        </td>
                        <td className="px-3 py-3">
                          {c.recommendation ? (
                            <Badge
                              variant={recommendationVariant(c.recommendation)}
                              size="sm"
                            >
                              {c.recommendation}
                            </Badge>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="lg:col-span-1">
          <Card
            title="Needs HR Action"
            action={
              needsAction.length > 0 ? (
                <Badge variant="warning" size="sm">
                  {needsAction.length}
                </Badge>
              ) : null
            }
          >
            {needsAction.length === 0 ? (
              <EmptyState
                icon={<BellAlertIcon />}
                title="All clear"
                description="No candidates are awaiting HR review."
              />
            ) : (
              <div className="max-h-[28rem] overflow-y-auto -mx-1 px-1 space-y-2">
                {needsAction.map((app) => (
                  <Link
                    key={app.id}
                    href={`/candidates/${app.candidate_id}`}
                    className="block p-3 rounded-lg bg-amber-50/60 border border-amber-100 hover:bg-amber-50 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {app.candidate_name || "Unnamed"}
                      </p>
                      <Badge variant="warning" size="sm">
                        Hold
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-600 truncate">
                      {app.job_title}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5 text-xs">
                      <span className={`font-semibold ${scoreColor(app.resume_score)}`}>
                        Resume: {app.resume_score ?? "—"}
                      </span>
                      {app.interview_score !== null && (
                        <span className={`font-semibold ${scoreColor(app.interview_score)}`}>
                          Interview: {app.interview_score}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Row 4: Active Jobs + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card
            title="Active Jobs"
            action={
              <Link
                href="/jobs"
                className="text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                View all →
              </Link>
            }
          >
            {jobs.length === 0 ? (
              <EmptyState
                icon={<BriefcaseIcon />}
                title="No jobs yet"
                description="Create a job to start receiving applications."
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {jobs.map((job) => (
                  <Link
                    key={job.id}
                    href={`/jobs/${job.id}`}
                    className="group flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 transition-all"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 group-hover:text-blue-600 truncate">
                        {job.title}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {job.department || job.job_id}
                        {job.location ? ` · ${job.location}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span className="text-lg font-bold text-slate-900 leading-none">
                        {job.candidate_count ?? 0}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide text-slate-400">
                        candidates
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="lg:col-span-1">
          <Card title="Recent Activity">
            {activity.length === 0 ? (
              <EmptyState
                icon={<InboxIcon />}
                title="No recent activity"
                description="Activity will appear as candidates are processed."
              />
            ) : (
              <div className="max-h-[28rem] overflow-y-auto -mx-1 px-1 space-y-3">
                {activity.map((event) => (
                  <div
                    key={event.id}
                    className="flex flex-col gap-1 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge
                        variant={eventBadgeVariant(event.event_type)}
                        size="sm"
                      >
                        {eventLabel(event.event_type)}
                      </Badge>
                      <span className="text-xs text-slate-400 whitespace-nowrap">
                        {timeAgo(event.created_at)}
                      </span>
                    </div>
                    {event.candidate_name && (
                      <p className="text-sm font-medium text-slate-800">
                        {event.candidate_name}
                      </p>
                    )}
                    {event.payload && (
                      <p className="text-xs text-slate-500 truncate">
                        {eventDescription(event.payload)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Row 5: Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <QuickAction
          href="/inbox"
          icon={<InboxIcon className="h-6 w-6" />}
          iconColor="bg-amber-50 text-amber-600"
          title="Sync Inbox"
          description="Process new emails and identify candidate applications."
        />
        <QuickAction
          href="/jobs/new"
          icon={<PlusCircleIcon className="h-6 w-6" />}
          iconColor="bg-blue-50 text-blue-600"
          title="Create Job"
          description="Post a new job opening and start receiving applications."
        />
        <QuickAction
          href="/candidates"
          icon={<UserGroupIcon className="h-6 w-6" />}
          iconColor="bg-purple-50 text-purple-600"
          title="View Candidates"
          description="Browse and manage all candidates in the pipeline."
        />
      </div>
    </div>
  );
}

function QuickAction({
  href,
  icon,
  iconColor,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  iconColor: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group block bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:border-blue-300 hover:shadow-md transition-all"
    >
      <div className="flex items-start gap-4">
        <div className={`flex-shrink-0 p-3 rounded-lg ${iconColor}`}>{icon}</div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
            {title}
          </h3>
          <p className="text-sm text-slate-500 mt-1">{description}</p>
        </div>
      </div>
    </Link>
  );
}
