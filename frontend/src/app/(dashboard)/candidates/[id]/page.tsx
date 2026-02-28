"use client";

import { use, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import {
  PIPELINE_STAGES,
  STAGE_COLORS,
  STAGE_LABELS,
  RECOMMENDATION_COLORS,
  scoreColor,
  scoreBg,
  timeAgo,
} from "@/lib/constants";
import type { Application, InterviewLink } from "@/types/index";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import {
  ArrowLeftIcon,
  EnvelopeIcon,
  PhoneIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  ShieldCheckIcon,
  MagnifyingGlassIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClipboardDocumentIcon,
  CalendarDaysIcon,
  LightBulbIcon,
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  PlayIcon,
  ClockIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import {
  CheckCircleIcon as CheckCircleSolid,
  StarIcon as StarSolid,
} from "@heroicons/react/24/solid";

// ── Helpers ────────────────────────────────────────────────────────────────

function scoreBarColor(score: number): string {
  if (score >= 70) return "bg-green-500";
  if (score >= 50) return "bg-yellow-500";
  return "bg-red-500";
}

function scoreBarTrack(score: number): string {
  if (score >= 70) return "bg-green-100";
  if (score >= 50) return "bg-yellow-100";
  return "bg-red-100";
}

function decisionVariant(decision: string): {
  bg: string;
  text: string;
  label: string;
} {
  switch (decision?.toLowerCase()) {
    case "advance":
      return {
        bg: "bg-green-100",
        text: "text-green-800",
        label: "Advance",
      };
    case "hold":
      return {
        bg: "bg-yellow-100",
        text: "text-yellow-800",
        label: "Hold",
      };
    case "reject":
      return { bg: "bg-red-100", text: "text-red-800", label: "Reject" };
    default:
      return {
        bg: "bg-slate-100",
        text: "text-slate-700",
        label: decision || "Unknown",
      };
  }
}

// ── Main Page Component ────────────────────────────────────────────────────

export default function CandidateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [app, setApp] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Action loading states
  const [stageLoading, setStageLoading] = useState(false);
  const [evaluateLoading, setEvaluateLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Transcript collapse
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  // Interview link
  const [linkLoading, setLinkLoading] = useState(false);
  const [interviewLink, setInterviewLink] = useState<InterviewLink | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // ── Fetch application data ───────────────────────────────────────────────

  const fetchApplication = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiGet<Application>(`/applications/${id}`);
      setApp(data);

      // Fetch existing interview links if link status exists
      if (data.interview_link_status && !["expired"].includes(data.interview_link_status)) {
        try {
          const links = await apiGet<{ links: InterviewLink[] }>(`/screening/${id}/links`);
          if (links.links && links.links.length > 0) {
            // Get the most recent active link
            const activeLink = links.links.find(
              (l: InterviewLink) => !["expired", "interview_completed"].includes(l.status)
            ) || links.links[0];
            setInterviewLink(activeLink);
          }
        } catch {
          // Silently fail — links endpoint may not exist for old apps
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load application"
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchApplication();
  }, [fetchApplication]);

  // ── Stage change handler ─────────────────────────────────────────────────

  const handleStageChange = async (newStage: string) => {
    if (!app || newStage === app.stage) return;
    const prevStage = app.stage;
    setApp((prev) => (prev ? { ...prev, stage: newStage } : prev));
    setStageLoading(true);
    try {
      await apiPatch(`/applications/${id}/stage`, { stage: newStage });
      await fetchApplication();
    } catch {
      setApp((prev) => (prev ? { ...prev, stage: prevStage } : prev));
      alert("Failed to update stage. Please try again.");
    } finally {
      setStageLoading(false);
    }
  };

  // ── Action button handlers ───────────────────────────────────────────────

  const handleAdvance = () => handleStageChange("shortlisted");
  const handleHold = () => handleStageChange("screening_scheduled");
  const handleReject = () => handleStageChange("rejected");

  const handleGenerateLink = async () => {
    setLinkLoading(true);
    try {
      const result = await apiPost<InterviewLink>("/screening/generate-link", {
        app_id: Number(id),
      });
      setInterviewLink(result);
      await fetchApplication();
    } catch {
      alert("Failed to generate interview link.");
    } finally {
      setLinkLoading(false);
    }
  };

  const handleCopyLink = async () => {
    if (!interviewLink) return;
    try {
      await navigator.clipboard.writeText(interviewLink.interview_url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      alert("Failed to copy link.");
    }
  };

  const [sendEmailLoading, setSendEmailLoading] = useState(false);

  const handleSendLink = async () => {
    if (!interviewLink) return;
    setSendEmailLoading(true);
    try {
      await apiPost("/screening/send-link", { token: interviewLink.token });
      setInterviewLink((prev) => prev ? { ...prev, status: "sent" } : prev);
      await fetchApplication();
    } catch {
      alert("Failed to send interview email.");
    } finally {
      setSendEmailLoading(false);
    }
  };

  const handleEvaluate = async () => {
    setEvaluateLoading(true);
    try {
      await apiPost("/screening/evaluate", { app_id: Number(id) });
      await fetchApplication();
    } catch {
      alert("Failed to evaluate screening. Please try again.");
    } finally {
      setEvaluateLoading(false);
    }
  };

  const [bookingSlot, setBookingSlot] = useState<string | null>(null);
  const [sendDraftLoading, setSendDraftLoading] = useState(false);
  const [finalScoreLoading, setFinalScoreLoading] = useState(false);

  const handleCopyEmail = async () => {
    const draft = app?.interview_score_json?.email_draft;
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("Failed to copy to clipboard.");
    }
  };

  const handleBookSlot = async (slot: string) => {
    setBookingSlot(slot);
    try {
      await apiPost(`/screening/${id}/book-slot`, { slot });
      await fetchApplication();
    } catch {
      alert("Failed to book interview slot.");
    } finally {
      setBookingSlot(null);
    }
  };

  const handleSendDraft = async () => {
    setSendDraftLoading(true);
    try {
      await apiPost(`/screening/${id}/send-draft`, {});
      await fetchApplication();
    } catch {
      alert("Failed to send email draft.");
    } finally {
      setSendDraftLoading(false);
    }
  };

  const handleCalculateFinalScore = async () => {
    setFinalScoreLoading(true);
    try {
      await apiPost(`/screening/${id}/calculate-final-score`, {});
      await fetchApplication();
    } catch {
      alert("Failed to calculate final score.");
    } finally {
      setFinalScoreLoading(false);
    }
  };


  // ── Loading State ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <LoadingSpinner size="lg" />
          <p className="text-sm text-slate-500">Loading candidate details...</p>
        </div>
      </div>
    );
  }

  // ── Error State ──────────────────────────────────────────────────────────

  if (error || !app) {
    return (
      <div className="space-y-4">
        <Link
          href="/candidates"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Candidates
        </Link>
        <div className="flex items-center justify-center min-h-[40vh]">
          <div className="text-center">
            <XCircleIcon className="h-12 w-12 text-red-300 mx-auto mb-3" />
            <p className="text-lg font-medium text-slate-700">
              Failed to load candidate
            </p>
            <p className="text-sm text-slate-500 mt-1">
              {error || "Application not found."}
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={fetchApplication}
            >
              Try Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Destructure data ─────────────────────────────────────────────────────

  const resume = app.resume_score_json;
  const interview = app.interview_score_json;
  const snippets = app.ai_snippets;

  // ════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════════

  // ── Threshold helpers ───────────────────────────────────────────────────
  const thresholds = app.thresholds || { resume_min: 80, interview_min: 75, reject_below: 50 };
  const resumeScore = resume?.score ?? app.resume_score ?? 0;
  const interviewScore = interview?.score ?? app.interview_score ?? 0;
  const resumePass = resumeScore >= thresholds.resume_min;
  const interviewPass = interviewScore >= thresholds.interview_min;
  const allThresholdsMet = resumePass && interviewPass;
  const summaryDecisionLabel = app.recommendation
    ? app.recommendation.charAt(0).toUpperCase() + app.recommendation.slice(1)
    : allThresholdsMet ? "Advance" : (app.final_score && app.final_score < thresholds.reject_below) ? "Reject" : "Hold";
  const summaryDecisionColor = (summaryDecisionLabel === "Advance")
    ? { bg: "bg-green-50 border-green-200", banner: "bg-green-600", text: "text-green-800", icon: "text-green-600", badge: "bg-green-100 text-green-800" }
    : (summaryDecisionLabel === "Reject")
    ? { bg: "bg-red-50 border-red-200", banner: "bg-red-600", text: "text-red-800", icon: "text-red-600", badge: "bg-red-100 text-red-800" }
    : { bg: "bg-amber-50 border-amber-200", banner: "bg-amber-500", text: "text-amber-800", icon: "text-amber-600", badge: "bg-amber-100 text-amber-800" };

  return (
    <div className="space-y-5">
      {/* ── Back link ──────────────────────────────────────────────────────── */}
      <Link
        href="/candidates"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors group"
      >
        <ArrowLeftIcon className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
        Back to Candidates
      </Link>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* FULL-WIDTH: Candidate Header                                      */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <Card>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 truncate">
              {app.candidate_name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-500">
              <a
                href={`mailto:${app.candidate_email}`}
                className="inline-flex items-center gap-1.5 hover:text-indigo-600 transition-colors"
              >
                <EnvelopeIcon className="h-4 w-4 shrink-0" />
                <span className="truncate">{app.candidate_email}</span>
              </a>
              {app.candidate_phone && (
                <span className="inline-flex items-center gap-1.5">
                  <PhoneIcon className="h-4 w-4 shrink-0" />
                  {app.candidate_phone}
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-700 font-medium">
                {app.job_title}
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">
                {app.job_code}
              </span>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  STAGE_COLORS[app.stage] || "bg-slate-100 text-slate-700"
                }`}
              >
                {STAGE_LABELS[app.stage] || app.stage}
              </span>
              {app.recommendation && (
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${
                    RECOMMENDATION_COLORS[app.recommendation] ||
                    "bg-slate-100 text-slate-600"
                  }`}
                >
                  {app.recommendation}
                </span>
              )}
            </div>

            <p className="mt-2 text-xs text-slate-400">
              Applied {timeAgo(app.created_at)} &middot; Updated{" "}
              {timeAgo(app.updated_at)}
            </p>
          </div>

          <div className="shrink-0">
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Move to Stage
            </label>
            <select
              value={app.stage}
              onChange={(e) => handleStageChange(e.target.value)}
              disabled={stageLoading}
              className="block w-full sm:w-44 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
            >
              {PIPELINE_STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s] || s}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* FULL-WIDTH: Summary Dashboard (only when final score exists)      */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {app.final_score ? (
        <div className={`rounded-xl border-2 ${summaryDecisionColor.bg} overflow-hidden`}>
          {/* Decision banner */}
          <div className={`${summaryDecisionColor.banner} px-5 py-3 flex items-center justify-between`}>
            <div className="flex items-center gap-2.5">
              {summaryDecisionLabel === "Advance" && <CheckCircleSolid className="h-5 w-5 text-white" />}
              {summaryDecisionLabel === "Hold" && <ExclamationTriangleIcon className="h-5 w-5 text-white" />}
              {summaryDecisionLabel === "Reject" && <XCircleIcon className="h-5 w-5 text-white" />}
              <span className="text-white font-bold text-sm tracking-wide uppercase">
                Decision: {summaryDecisionLabel}
              </span>
            </div>
            <span className="text-white/80 text-xs font-medium">
              {allThresholdsMet ? "All thresholds met" : "Threshold not met"}
            </span>
          </div>

          <div className="px-5 py-4 space-y-4">
            {/* Score strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Resume */}
              <div className={`rounded-lg p-3 border text-center ${resumePass ? "bg-white border-green-200" : "bg-white border-red-200"}`}>
                <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Resume</p>
                <p className={`text-2xl font-extrabold tabular-nums ${resumePass ? "text-green-600" : "text-red-600"}`}>
                  {resumeScore}
                </p>
                <p className={`text-xs mt-0.5 font-medium ${resumePass ? "text-green-600" : "text-red-600"}`}>
                  {resumePass ? "✓" : "✗"} {thresholds.resume_min}% min
                </p>
              </div>

              {/* Interview */}
              <div className={`rounded-lg p-3 border text-center ${interviewPass ? "bg-white border-green-200" : "bg-white border-red-200"}`}>
                <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Interview</p>
                <p className={`text-2xl font-extrabold tabular-nums ${interviewPass ? "text-green-600" : "text-red-600"}`}>
                  {interviewScore}
                </p>
                <p className={`text-xs mt-0.5 font-medium ${interviewPass ? "text-green-600" : "text-red-600"}`}>
                  {interviewPass ? "✓" : "✗"} {thresholds.interview_min}% min
                </p>
              </div>

              {/* Final combined */}
              <div className="rounded-lg p-3 border bg-white border-slate-200 text-center">
                <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Final Score</p>
                <p className={`text-2xl font-extrabold tabular-nums ${scoreColor(app.final_score)}`}>
                  {app.final_score}
                </p>
                <p className="text-xs mt-0.5 text-slate-400">40% + 60%</p>
              </div>

              {/* Next Step */}
              <div className={`rounded-lg p-3 border text-center ${
                app.scheduled_interview_slot ? "bg-white border-green-200"
                : summaryDecisionLabel === "Hold" ? "bg-white border-amber-200"
                : summaryDecisionLabel === "Reject" ? "bg-white border-red-200"
                : "bg-white border-slate-200"
              }`}>
                <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Next Step</p>
                {app.scheduled_interview_slot ? (
                  <>
                    <CalendarDaysIcon className="h-5 w-5 text-green-600 mx-auto" />
                    <p className="text-xs mt-0.5 font-semibold text-green-700 leading-tight">
                      {app.scheduled_interview_slot}
                    </p>
                  </>
                ) : summaryDecisionLabel === "Hold" ? (
                  <>
                    <ExclamationTriangleIcon className="h-5 w-5 text-amber-500 mx-auto" />
                    <p className="text-xs mt-0.5 font-semibold text-amber-700">HR Decision Needed</p>
                  </>
                ) : summaryDecisionLabel === "Reject" ? (
                  <>
                    <XCircleIcon className="h-5 w-5 text-red-500 mx-auto" />
                    <p className="text-xs mt-0.5 font-semibold text-red-700">Rejected</p>
                  </>
                ) : (
                  <>
                    <ClockIcon className="h-5 w-5 text-slate-400 mx-auto" />
                    <p className="text-xs mt-0.5 text-slate-400">Pending</p>
                  </>
                )}
              </div>
            </div>

            {/* AI summary */}
            {app.final_summary && (
              <div className="bg-white rounded-lg p-3 border border-slate-200">
                <div className="flex items-start gap-2">
                  <LightBulbIcon className="h-4 w-4 text-indigo-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-slate-700 leading-relaxed">{app.final_summary}</p>
                </div>
              </div>
            )}

            {/* AI Next Action */}
            {app.ai_next_action && (
              <div className="flex items-start gap-2 px-1">
                <ArrowPathIcon className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />
                <p className="text-xs text-slate-500">{app.ai_next_action}</p>
              </div>
            )}
          </div>
        </div>
      ) : (resume && interview) ? (
        /* Both scores exist but no final score yet — show calculate button */
        <Card>
          <div className="text-center py-3">
            <p className="text-sm text-slate-500 mb-3">Resume and interview scores available. Calculate the combined final assessment.</p>
            <Button
              size="sm"
              onClick={handleCalculateFinalScore}
              loading={finalScoreLoading}
            >
              <LightBulbIcon className="h-4 w-4" />
              Calculate Final Score
            </Button>
          </div>
        </Card>
      ) : null}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* FULL-WIDTH: Quick Actions — Decision-aware                        */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {interview && (
        <>
          {/* ── ADVANCE: Interview is scheduled ──────────────────────────── */}
          {app.scheduled_interview_slot && (
            <Card title="Scheduled Interview">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircleSolid className="h-5 w-5 text-green-600" />
                  <p className="text-sm font-semibold text-green-800">Interview Scheduled</p>
                </div>
                {interview.candidate_preferred_slot && (
                  <p className="text-xs text-green-600 mb-2 flex items-center gap-1">
                    <ChatBubbleLeftRightIcon className="h-3.5 w-3.5" />
                    Candidate chose: &ldquo;{interview.candidate_preferred_slot}&rdquo;
                  </p>
                )}
                <div className="bg-white border border-green-300 rounded-lg p-3 text-center">
                  <CalendarDaysIcon className="h-5 w-5 text-green-600 mx-auto mb-1" />
                  <p className="text-sm font-bold text-green-800">{app.scheduled_interview_slot}</p>
                </div>
              </div>
            </Card>
          )}

          {/* ── HOLD: HR needs to decide — show actions + candidate preference ── */}
          {!app.scheduled_interview_slot && summaryDecisionLabel === "Hold" && app.final_score && (
            <div className="rounded-xl border-2 border-amber-200 bg-amber-50 overflow-hidden">
              <div className="bg-amber-500 px-5 py-2.5 flex items-center gap-2">
                <ExclamationTriangleIcon className="h-4 w-4 text-white" />
                <span className="text-white font-semibold text-sm">HR Decision Required</span>
              </div>
              <div className="px-5 py-4 space-y-4">
                <p className="text-sm text-amber-800">
                  Candidate didn&apos;t meet all thresholds (Interview {interviewScore}% &lt; {thresholds.interview_min}% required).
                  Review the details below and decide whether to advance or reject.
                </p>

                {/* Candidate's preferred slot — approve & schedule */}
                {interview.candidate_preferred_slot && (
                  <div className="bg-white border border-amber-200 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <CalendarDaysIcon className="h-5 w-5 text-amber-600 shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-slate-500 uppercase">Candidate&apos;s Preferred Slot</p>
                        <p className="text-sm font-semibold text-slate-800">{interview.candidate_preferred_slot}</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleBookSlot(interview.candidate_preferred_slot!)}
                      loading={bookingSlot === interview.candidate_preferred_slot}
                      className="w-full justify-center"
                    >
                      <CheckCircleIcon className="h-4 w-4" />
                      Approve &amp; Schedule Interview
                    </Button>
                  </div>
                )}

                {/* Other available slots if no preferred slot or HR wants a different time */}
                {interview.scheduling_slots && interview.scheduling_slots.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                      {interview.candidate_preferred_slot ? "Or pick a different slot" : "Pick an interview slot to approve"}
                    </p>
                    <div className="space-y-1.5">
                      {interview.scheduling_slots.map((slot, i) => (
                        <button
                          key={i}
                          onClick={() => handleBookSlot(slot)}
                          disabled={bookingSlot !== null}
                          className={`w-full flex items-center gap-2.5 rounded-lg border p-2.5 transition-all text-left ${
                            bookingSlot === slot
                              ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200"
                              : "border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/50 hover:shadow-sm"
                          } disabled:opacity-50`}
                        >
                          <CalendarDaysIcon className={`h-4 w-4 shrink-0 ${bookingSlot === slot ? "text-indigo-600 animate-pulse" : "text-indigo-500"}`} />
                          <span className="text-sm text-slate-700 flex-1">{slot}</span>
                          {bookingSlot === slot && <LoadingSpinner size="sm" />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reject option */}
                <div className="pt-2 border-t border-amber-200">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={handleReject}
                    loading={stageLoading}
                    className="w-full justify-center"
                  >
                    <XCircleIcon className="h-4 w-4" />
                    Reject Candidate
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ── REJECT: confirmed rejection — HR can still override ──────────── */}
          {!app.scheduled_interview_slot && summaryDecisionLabel === "Reject" && app.final_score && (
            <div className="rounded-xl border-2 border-red-200 bg-red-50 overflow-hidden">
              <div className="bg-red-600 px-5 py-2.5 flex items-center gap-2">
                <XCircleIcon className="h-4 w-4 text-white" />
                <span className="text-white font-semibold text-sm">Candidate Rejected</span>
              </div>
              <div className="px-5 py-4 space-y-4">
                <p className="text-sm text-red-800">
                  Final score {app.final_score}% is below the reject threshold of {thresholds.reject_below}%.
                </p>

                {/* Override: schedule interview from preferred slot */}
                {interview.candidate_preferred_slot && (
                  <div className="bg-white border border-red-200 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <CalendarDaysIcon className="h-5 w-5 text-slate-500 shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-slate-500 uppercase">Candidate&apos;s Preferred Slot</p>
                        <p className="text-sm font-semibold text-slate-800">{interview.candidate_preferred_slot}</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleBookSlot(interview.candidate_preferred_slot!)}
                      loading={bookingSlot === interview.candidate_preferred_slot}
                      className="w-full justify-center"
                    >
                      <CheckCircleIcon className="h-4 w-4" />
                      Override &amp; Schedule Interview
                    </Button>
                  </div>
                )}

                {/* Alternative slots */}
                {interview.scheduling_slots && interview.scheduling_slots.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                      {interview.candidate_preferred_slot ? "Or pick a different slot" : "Override: pick a slot to schedule"}
                    </p>
                    <div className="space-y-1.5">
                      {interview.scheduling_slots.map((slot, i) => (
                        <button
                          key={i}
                          onClick={() => handleBookSlot(slot)}
                          disabled={bookingSlot !== null}
                          className={`w-full flex items-center gap-2.5 rounded-lg border p-2.5 transition-all text-left ${
                            bookingSlot === slot
                              ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200"
                              : "border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/50 hover:shadow-sm"
                          } disabled:opacity-50`}
                        >
                          <CalendarDaysIcon className={`h-4 w-4 shrink-0 ${bookingSlot === slot ? "text-indigo-600 animate-pulse" : "text-indigo-500"}`} />
                          <span className="text-sm text-slate-700 flex-1">{slot}</span>
                          {bookingSlot === slot && <LoadingSpinner size="sm" />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── No final score yet but slots exist: show booking ──────────── */}
          {!app.scheduled_interview_slot && !app.final_score && interview.scheduling_slots && interview.scheduling_slots.length > 0 && (
            <Card title="Book Interview Slot">
              <div className="space-y-2">
                <p className="text-xs text-slate-500 mb-1">Click a slot to book and auto-send scheduling email:</p>
                {interview.scheduling_slots.map((slot, i) => (
                  <button
                    key={i}
                    onClick={() => handleBookSlot(slot)}
                    disabled={bookingSlot !== null}
                    className={`w-full flex items-center gap-2.5 rounded-lg border p-3 transition-all text-left ${
                      bookingSlot === slot
                        ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200"
                        : "border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 hover:shadow-sm"
                    } disabled:opacity-50`}
                  >
                    <CalendarDaysIcon className={`h-4 w-4 shrink-0 ${bookingSlot === slot ? "text-indigo-600 animate-pulse" : "text-indigo-500"}`} />
                    <span className="text-sm text-slate-700 flex-1">{slot}</span>
                    {bookingSlot === slot && (
                      <LoadingSpinner size="sm" />
                    )}
                  </button>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TWO-COLUMN: Detailed Info (scroll down)                           */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ================================================================ */}
        {/* LEFT COLUMN — Detail Cards                                      */}
        {/* ================================================================ */}
        <div className="lg:col-span-2 space-y-6">

          {/* ── Resume Score Card ───────────────────────────────────────────── */}
          {resume && (
            <Card title="Resume Score">
              <div className="space-y-5">
                {/* Score header */}
                <div className="flex items-center gap-4">
                  <div
                    className={`flex items-center justify-center w-16 h-16 rounded-xl ${scoreBg(resume.score)}`}
                  >
                    <span
                      className={`text-2xl font-bold tabular-nums ${scoreColor(resume.score)}`}
                    >
                      {resume.score}
                    </span>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-slate-700">
                        Match Score
                      </span>
                      <span
                        className={`text-sm font-semibold tabular-nums ${scoreColor(resume.score)}`}
                      >
                        {resume.score}/100
                      </span>
                    </div>
                    <div
                      className={`w-full h-2.5 rounded-full ${scoreBarTrack(resume.score)}`}
                    >
                      <div
                        className={`h-2.5 rounded-full transition-all duration-500 ${scoreBarColor(resume.score)}`}
                        style={{ width: `${Math.min(resume.score, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Evidence */}
                {resume.evidence.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                      <CheckCircleSolid className="h-4 w-4 text-green-500" />
                      Evidence
                    </h4>
                    <ul className="space-y-1.5">
                      {resume.evidence.map((item, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-sm text-slate-600"
                        >
                          <CheckCircleIcon className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Gaps */}
                {resume.gaps.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                      <ExclamationTriangleIcon className="h-4 w-4 text-yellow-500" />
                      Gaps
                    </h4>
                    <ul className="space-y-1.5">
                      {resume.gaps.map((item, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-sm text-slate-600"
                        >
                          <ExclamationTriangleIcon className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Risks */}
                {resume.risks.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                      <XCircleIcon className="h-4 w-4 text-red-500" />
                      Risks
                    </h4>
                    <ul className="space-y-1.5">
                      {resume.risks.map((item, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-sm text-slate-600"
                        >
                          <XCircleIcon className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Screening Questions */}
                {resume.screening_questions.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                      <ChatBubbleLeftRightIcon className="h-4 w-4 text-indigo-500" />
                      Screening Questions
                    </h4>
                    <ol className="space-y-1.5 list-decimal list-inside">
                      {resume.screening_questions.map((q, i) => (
                        <li
                          key={i}
                          className="text-sm text-slate-600 pl-1"
                        >
                          {q}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* Summary */}
                {resume.summary && (
                  <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
                    <h4 className="text-sm font-semibold text-slate-700 mb-1">
                      Summary
                    </h4>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      {resume.summary}
                    </p>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* ── Interview Score Card ────────────────────────────────────────── */}
          {interview && (
            <Card title="Interview Score">
              <div className="space-y-5">
                {/* Score + Decision header */}
                <div className="flex items-center gap-4">
                  <div
                    className={`flex items-center justify-center w-16 h-16 rounded-xl ${scoreBg(interview.score)}`}
                  >
                    <span
                      className={`text-2xl font-bold tabular-nums ${scoreColor(interview.score)}`}
                    >
                      {interview.score}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Interview Score</p>
                    {interview.decision && (
                      <span
                        className={`inline-flex items-center mt-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${decisionVariant(interview.decision).bg} ${decisionVariant(interview.decision).text}`}
                      >
                        {decisionVariant(interview.decision).label}
                      </span>
                    )}
                  </div>
                </div>

                {/* Rating cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    {
                      label: "Communication",
                      value: interview.communication_rating,
                    },
                    {
                      label: "Technical Depth",
                      value: interview.technical_depth,
                    },
                    {
                      label: "Cultural Fit",
                      value: interview.cultural_fit,
                    },
                  ].map(({ label, value }) => (
                    <div
                      key={label}
                      className="bg-slate-50 rounded-lg p-3 border border-slate-100 text-center"
                    >
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                        {label}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-800 capitalize">
                        {value || "N/A"}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Strengths */}
                {interview.strengths.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                      <CheckCircleSolid className="h-4 w-4 text-green-500" />
                      Strengths
                    </h4>
                    <ul className="space-y-1.5">
                      {interview.strengths.map((item, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-sm text-slate-600"
                        >
                          <CheckCircleIcon className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Concerns */}
                {interview.concerns.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                      <XCircleIcon className="h-4 w-4 text-red-500" />
                      Concerns
                    </h4>
                    <ul className="space-y-1.5">
                      {interview.concerns.map((item, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-sm text-slate-600"
                        >
                          <XCircleIcon className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Summary */}
                {interview.summary && (
                  <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
                    <h4 className="text-sm font-semibold text-slate-700 mb-1">
                      Summary
                    </h4>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      {interview.summary}
                    </p>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* ── Interview Link / Transcript ──────────────────────────────────── */}
          <Card
            title="Interview"
            action={
              <div className="flex items-center gap-2">
                {/* Only show Generate if no link exists and no transcript */}
                {!app.screening_transcript && !interviewLink && !app.interview_link_status && (
                  <Button
                    size="sm"
                    onClick={handleGenerateLink}
                    loading={linkLoading}
                  >
                    <PlayIcon className="h-4 w-4" />
                    Generate Interview Link
                  </Button>
                )}
                {app.screening_transcript && !interview && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleEvaluate}
                    loading={evaluateLoading}
                  >
                    <LightBulbIcon className="h-4 w-4" />
                    Evaluate
                  </Button>
                )}
                {app.screening_transcript && (
                  <button
                    onClick={() => setTranscriptOpen(!transcriptOpen)}
                    className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    {transcriptOpen ? (
                      <>
                        <ChevronUpIcon className="h-4 w-4" />
                        Collapse
                      </>
                    ) : (
                      <>
                        <ChevronDownIcon className="h-4 w-4" />
                        Expand
                      </>
                    )}
                  </button>
                )}
              </div>
            }
          >
            {/* ─── Interview Link Status Section ─────────────────────────────── */}
            {interviewLink && !app.screening_transcript && (
              <div className="space-y-3 mb-4">
                <div className={`rounded-lg p-4 border ${
                  interviewLink.status === "sent" ? "bg-indigo-50 border-indigo-200"
                  : interviewLink.status === "opened" ? "bg-cyan-50 border-cyan-200"
                  : interviewLink.status === "interview_started" ? "bg-blue-50 border-blue-200"
                  : interviewLink.status === "interview_completed" ? "bg-green-50 border-green-200"
                  : interviewLink.status === "expired" ? "bg-slate-50 border-slate-200"
                  : "bg-cyan-50 border-cyan-200"
                }`}>
                  {/* Status header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {interviewLink.status === "sent" && <EnvelopeIcon className="h-4 w-4 text-indigo-600" />}
                      {interviewLink.status === "generated" && <PlayIcon className="h-4 w-4 text-cyan-600" />}
                      {interviewLink.status === "opened" && <CheckCircleIcon className="h-4 w-4 text-cyan-600" />}
                      {interviewLink.status === "interview_started" && <ChatBubbleLeftRightIcon className="h-4 w-4 text-blue-600" />}
                      {interviewLink.status === "interview_completed" && <CheckCircleSolid className="h-4 w-4 text-green-600" />}
                      {interviewLink.status === "expired" && <ClockIcon className="h-4 w-4 text-slate-500" />}
                      <p className={`text-sm font-semibold ${
                        interviewLink.status === "sent" ? "text-indigo-800"
                        : interviewLink.status === "opened" ? "text-cyan-800"
                        : interviewLink.status === "interview_started" ? "text-blue-800"
                        : interviewLink.status === "interview_completed" ? "text-green-800"
                        : interviewLink.status === "expired" ? "text-slate-700"
                        : "text-cyan-800"
                      }`}>
                        {interviewLink.status === "sent" && "Interview Link Sent"}
                        {interviewLink.status === "generated" && "Interview Link Ready"}
                        {interviewLink.status === "opened" && "Link Opened by Candidate"}
                        {interviewLink.status === "interview_started" && "Interview In Progress"}
                        {interviewLink.status === "interview_completed" && "Interview Completed"}
                        {interviewLink.status === "expired" && "Interview Link Expired"}
                      </p>
                    </div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                      interviewLink.status === "sent" ? "bg-indigo-100 text-indigo-700"
                      : interviewLink.status === "opened" ? "bg-cyan-100 text-cyan-700"
                      : interviewLink.status === "interview_started" ? "bg-blue-100 text-blue-700"
                      : interviewLink.status === "interview_completed" ? "bg-green-100 text-green-700"
                      : interviewLink.status === "expired" ? "bg-slate-100 text-slate-600"
                      : "bg-cyan-100 text-cyan-700"
                    }`}>
                      {(interviewLink.status || "").replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}
                    </span>
                  </div>

                  {/* Link URL (not shown for expired) */}
                  {interviewLink.status !== "expired" && (
                    <div className="flex items-center gap-2 mb-3">
                      <input
                        type="text"
                        readOnly
                        value={interviewLink.interview_url}
                        className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 font-mono truncate"
                      />
                      <Button size="sm" variant="secondary" onClick={handleCopyLink}>
                        <ClipboardDocumentIcon className="h-3.5 w-3.5" />
                        {linkCopied ? "Copied!" : "Copy"}
                      </Button>
                    </div>
                  )}

                  {/* Info row: timestamps + expiry */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    {interviewLink.expires_at && (
                      <span className={`${
                        interviewLink.status === "expired" ? "text-red-500" : "text-slate-500"
                      }`}>
                        <ClockIcon className="h-3.5 w-3.5 inline mr-1" />
                        {interviewLink.status === "expired" ? "Expired" : "Expires"}: {new Date(interviewLink.expires_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                    {interviewLink.created_at && (
                      <span className="text-slate-400">
                        Created: {timeAgo(interviewLink.created_at)}
                      </span>
                    )}
                  </div>

                  {/* Action buttons based on status */}
                  <div className="mt-3 flex items-center gap-2">
                    {/* Generated but not sent → Send Email */}
                    {interviewLink.status === "generated" && (
                      <Button size="sm" onClick={handleSendLink} loading={sendEmailLoading}>
                        <EnvelopeIcon className="h-4 w-4" />
                        Send Email to Candidate
                      </Button>
                    )}
                    {/* Sent → Resend option */}
                    {interviewLink.status === "sent" && (
                      <Button size="sm" variant="secondary" onClick={handleSendLink} loading={sendEmailLoading}>
                        <ArrowPathIcon className="h-4 w-4" />
                        Resend Email
                      </Button>
                    )}
                    {/* Expired → Regenerate */}
                    {interviewLink.status === "expired" && (
                      <Button size="sm" onClick={handleGenerateLink} loading={linkLoading}>
                        <ArrowPathIcon className="h-4 w-4" />
                        Regenerate Link
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Fallback: link status without link data (edge case) */}
            {!interviewLink && app.interview_link_status && !app.screening_transcript && (
              <div className="space-y-3 mb-4">
                <div className="flex items-center justify-between bg-slate-50 rounded-lg p-4 border border-slate-200">
                  <span className="text-sm text-slate-600">Interview Link</span>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    app.interview_link_status === "interview_completed" ? "bg-green-100 text-green-800"
                    : app.interview_link_status === "interview_started" ? "bg-blue-100 text-blue-800"
                    : app.interview_link_status === "opened" ? "bg-cyan-100 text-cyan-800"
                    : app.interview_link_status === "sent" ? "bg-indigo-100 text-indigo-800"
                    : "bg-slate-100 text-slate-700"
                  }`}>
                    {(app.interview_link_status || "").replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}
                  </span>
                </div>
                {app.interview_link_status === "expired" && (
                  <Button size="sm" onClick={handleGenerateLink} loading={linkLoading} className="w-full justify-center">
                    <ArrowPathIcon className="h-4 w-4" />
                    Regenerate Link
                  </Button>
                )}
              </div>
            )}

            {/* Face tracking summary */}
            {app.interview_face_tracking_json && (
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-100 text-center">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Attention Score</p>
                  <p className="mt-1 text-lg font-bold text-slate-800">
                    {Math.round(app.interview_face_tracking_json.avg_attention_score * 100)}%
                  </p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-100 text-center">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Face Present</p>
                  <p className="mt-1 text-lg font-bold text-slate-800">
                    {app.interview_face_tracking_json.face_present_percentage}%
                  </p>
                </div>
              </div>
            )}

            {/* Interview Recording */}
            {app.interview_link_status === "interview_completed" && (
              <div className="mb-4">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Interview Recording</p>
                <audio
                  controls
                  className="w-full"
                  src={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1"}/screening/${app.id}/audio`}
                >
                  Your browser does not support audio playback.
                </audio>
              </div>
            )}

            {/* Transcript viewer */}
            {app.screening_transcript ? (
              <>
                {transcriptOpen ? (
                  <pre className="whitespace-pre-wrap font-mono text-sm text-slate-700 bg-slate-50 rounded-lg p-4 border border-slate-100 max-h-[500px] overflow-y-auto leading-relaxed">
                    {app.screening_transcript}
                  </pre>
                ) : (
                  <div className="flex items-center gap-3 text-sm text-slate-500">
                    <DocumentTextIcon className="h-5 w-5 text-slate-400" />
                    <span>
                      Transcript available ({app.screening_transcript.length.toLocaleString()} characters).
                      Click Expand to view.
                    </span>
                  </div>
                )}
              </>
            ) : !interviewLink && !app.interview_link_status ? (
              <div className="flex flex-col items-center py-8 text-center">
                <ChatBubbleLeftRightIcon className="h-10 w-10 text-slate-300 mb-3" />
                <p className="text-sm font-medium text-slate-500">
                  No interview yet
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Generate an interview link and send it to the candidate.
                </p>
              </div>
            ) : null}
          </Card>
        </div>

        {/* ================================================================ */}
        {/* RIGHT COLUMN                                                     */}
        {/* ================================================================ */}
        <div className="lg:col-span-1 space-y-6">
          {/* ── AI Insights Card ────────────────────────────────────────────── */}
          {snippets && (
            <Card title="AI Insights">
              <div className="space-y-5">
                {/* Why Shortlisted */}
                {snippets.why_shortlisted.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      Why Shortlisted
                    </h4>
                    <ul className="space-y-1.5">
                      {snippets.why_shortlisted.slice(0, 3).map((item, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-sm text-slate-600"
                        >
                          <StarSolid className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Key Strengths */}
                {snippets.key_strengths.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      Key Strengths
                    </h4>
                    <ul className="space-y-1.5">
                      {snippets.key_strengths.slice(0, 3).map((item, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-sm text-slate-600"
                        >
                          <ShieldCheckIcon className="h-4 w-4 text-indigo-500 mt-0.5 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Main Gaps */}
                {snippets.main_gaps.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      Main Gaps
                    </h4>
                    <ul className="space-y-1.5">
                      {snippets.main_gaps.slice(0, 2).map((item, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-sm text-slate-600"
                        >
                          <ExclamationTriangleIcon className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Interview Focus */}
                {snippets.interview_focus.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      Interview Focus
                    </h4>
                    <ul className="space-y-1.5">
                      {snippets.interview_focus.slice(0, 3).map((item, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-sm text-slate-600"
                        >
                          <MagnifyingGlassIcon className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Card>
          )}


          {/* ── Next Actions Card ───────────────────────────────────────────── */}
          <Card title="Actions">
            <div className="flex flex-col gap-2">
              <Button
                size="sm"
                onClick={handleAdvance}
                loading={stageLoading}
                className="w-full justify-center"
              >
                <CheckCircleIcon className="h-4 w-4" />
                Advance
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleHold}
                loading={stageLoading}
                className="w-full justify-center"
              >
                <ClockIcon className="h-4 w-4" />
                Hold
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleReject}
                loading={stageLoading}
                className="w-full justify-center"
              >
                <XCircleIcon className="h-4 w-4" />
                Reject
              </Button>
            </div>
          </Card>

        </div>
      </div>
    </div>
  );
}
