"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  BriefcaseIcon,
  UsersIcon,
  PhoneIcon,
  CheckCircleIcon,
  InboxIcon,
  PlusCircleIcon,
  UserGroupIcon,
  ChartBarIcon,
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
import { ReportSummary, ActivityEvent } from "@/types/index";
import { STAGE_LABELS, STAGE_COLORS, timeAgo } from "@/lib/constants";
import MetricCard from "@/components/ui/MetricCard";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";

/* ------------------------------------------------------------------ */
/*  Bar colors for the pipeline chart (gradient: blue -> red)          */
/* ------------------------------------------------------------------ */
const BAR_COLORS = [
  "#3b82f6", // blue   - new
  "#6366f1", // indigo - classified
  "#a855f7", // purple - matched
  "#eab308", // yellow - screening_scheduled
  "#f97316", // orange - screened
  "#22c55e", // green  - shortlisted
  "#ef4444", // red    - rejected
];

/* ------------------------------------------------------------------ */
/*  Map event_type to Badge variant                                    */
/* ------------------------------------------------------------------ */
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
  return eventType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function eventDescription(payload: Record<string, unknown>): string {
  if (payload.description && typeof payload.description === "string")
    return payload.description;
  if (payload.job_title && typeof payload.job_title === "string")
    return `Job: ${payload.job_title}`;
  if (payload.stage && typeof payload.stage === "string")
    return `Stage: ${STAGE_LABELS[payload.stage] || payload.stage}`;
  const keys = Object.keys(payload);
  if (keys.length === 0) return "";
  const first = payload[keys[0]];
  return typeof first === "string" ? first : "";
}

/* ================================================================== */
/*  Dashboard Page                                                     */
/* ================================================================== */
export default function DashboardPage() {
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const [summaryData, activityData] = await Promise.all([
          apiGet<ReportSummary>("/reports/summary"),
          apiGet<{ activity: ActivityEvent[] }>("/reports/activity"),
        ]);
        setSummary(summaryData);
        setActivity(activityData.activity?.slice(0, 10) ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard data");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  /* ---- Loading state ---- */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  /* ---- Error state ---- */
  if (error) {
    return (
      <EmptyState
        icon={<ChartBarIcon />}
        title="Failed to load dashboard"
        description={error}
      />
    );
  }

  /* ---- Prepare pipeline chart data ---- */
  const pipelineData = (summary?.stage_distribution ?? []).map((s) => ({
    stage: STAGE_LABELS[s.stage] || s.stage,
    count: s.count,
    rawStage: s.stage,
  }));

  return (
    <div className="space-y-6">
      {/* ---- Header ---- */}
      <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ROW 1 : Metric Cards                                       */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Jobs"
          value={summary?.total_jobs ?? 0}
          icon={<BriefcaseIcon />}
        />
        <MetricCard
          title="Total Candidates"
          value={summary?.total_candidates ?? 0}
          icon={<UsersIcon />}
        />
        <MetricCard
          title="Active Screenings"
          value={summary?.active_screenings ?? 0}
          icon={<PhoneIcon />}
        />
        <MetricCard
          title="Shortlisted"
          value={summary?.shortlisted_count ?? 0}
          icon={<CheckCircleIcon />}
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ROW 2 : Pipeline Chart + Recent Activity                   */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pipeline Chart (2/3 width) */}
        <div className="lg:col-span-2">
          <Card title="Pipeline Overview">
            {pipelineData.length === 0 ? (
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
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fontSize: 12, fill: "#64748b" }} />
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
                        boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                      }}
                      formatter={(value: number | undefined) => [value ?? 0, "Applications"]}
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={28}>
                      {pipelineData.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={BAR_COLORS[index % BAR_COLORS.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </div>

        {/* Recent Activity (1/3 width) */}
        <div className="lg:col-span-1">
          <Card title="Recent Activity">
            {activity.length === 0 ? (
              <EmptyState
                icon={<InboxIcon />}
                title="No recent activity"
                description="Activity will appear as candidates are processed."
              />
            ) : (
              <div className="max-h-80 overflow-y-auto -mx-1 px-1 space-y-3">
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
                    <p className="text-sm font-medium text-slate-800">
                      {event.candidate_name}
                    </p>
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

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ROW 3 : Quick Actions                                      */}
      {/* ═══════════════════════════════════════════════════════════ */}
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

/* ------------------------------------------------------------------ */
/*  Quick Action Card                                                  */
/* ------------------------------------------------------------------ */
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
        <div className={`flex-shrink-0 p-3 rounded-lg ${iconColor}`}>
          {icon}
        </div>
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
