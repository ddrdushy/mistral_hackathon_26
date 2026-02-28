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

  const handleSendLink = async () => {
    if (!interviewLink) return;
    try {
      await apiPost("/screening/send-link", { token: interviewLink.token });
      await fetchApplication();
    } catch {
      alert("Failed to mark link as sent.");
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

  return (
    <div className="space-y-6">
      {/* ── Back link ──────────────────────────────────────────────────────── */}
      <Link
        href="/candidates"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors group"
      >
        <ArrowLeftIcon className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
        Back to Candidates
      </Link>

      {/* ── Two-column layout ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ================================================================ */}
        {/* LEFT COLUMN                                                      */}
        {/* ================================================================ */}
        <div className="lg:col-span-2 space-y-6">
          {/* ── Candidate Header Card ──────────────────────────────────────── */}
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
                  {/* Job info */}
                  <span className="text-sm text-slate-700 font-medium">
                    {app.job_title}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">
                    {app.job_code}
                  </span>

                  {/* Stage badge */}
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      STAGE_COLORS[app.stage] || "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {STAGE_LABELS[app.stage] || app.stage}
                  </span>

                  {/* Recommendation badge */}
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

              {/* Stage change dropdown */}
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
                {!app.screening_transcript && !interviewLink && (
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
            {/* Interview link section */}
            {interviewLink && !app.screening_transcript && (
              <div className="space-y-3 mb-4">
                <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-4">
                  <p className="text-sm font-medium text-cyan-800 mb-2">Interview Link Generated</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={interviewLink.interview_url}
                      className="flex-1 rounded-md border border-cyan-300 bg-white px-3 py-1.5 text-sm text-slate-700 font-mono"
                    />
                    <Button size="sm" variant="secondary" onClick={handleCopyLink}>
                      <ClipboardDocumentIcon className="h-4 w-4" />
                      {linkCopied ? "Copied!" : "Copy"}
                    </Button>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <Button size="sm" onClick={handleSendLink}>
                      <EnvelopeIcon className="h-4 w-4" />
                      Mark as Sent
                    </Button>
                    <span className="text-xs text-cyan-600">
                      Expires: {new Date(interviewLink.expires_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Link status (when link was already generated) */}
            {!interviewLink && app.interview_link_status && !app.screening_transcript && (
              <div className="space-y-3 mb-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">Interview Link Status</span>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    app.interview_link_status === "interview_completed" ? "bg-green-100 text-green-800"
                    : app.interview_link_status === "interview_started" ? "bg-blue-100 text-blue-800"
                    : app.interview_link_status === "opened" ? "bg-cyan-100 text-cyan-800"
                    : app.interview_link_status === "sent" ? "bg-indigo-100 text-indigo-800"
                    : "bg-slate-100 text-slate-700"
                  }`}>
                    {(app.interview_link_status || "").replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
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
          <Card title="Next Actions">
            <div className="space-y-4">
              {/* AI next action */}
              {app.ai_next_action && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <LightBulbIcon className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                    <p className="text-sm text-blue-800 leading-relaxed">
                      {app.ai_next_action}
                    </p>
                  </div>
                </div>
              )}

              {/* Action buttons */}
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
                <div className="border-t border-slate-100 pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-center"
                    onClick={() =>
                      alert("Schedule interview feature coming soon.")
                    }
                  >
                    <CalendarDaysIcon className="h-4 w-4" />
                    Schedule Interview
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          {/* ── Email Draft Card ─────────────────────────────────────────────── */}
          {interview?.email_draft && (
            <Card title="Email Draft">
              <div className="space-y-3">
                <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
                  <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700 leading-relaxed">
                    {interview.email_draft}
                  </pre>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleCopyEmail}
                  className="w-full justify-center"
                >
                  <ClipboardDocumentIcon className="h-4 w-4" />
                  {copied ? "Copied!" : "Copy to Clipboard"}
                </Button>
              </div>
            </Card>
          )}

          {/* ── Scheduling Card ──────────────────────────────────────────────── */}
          {interview?.scheduling_slots && interview.scheduling_slots.length > 0 && (
            <Card title="Proposed Time Slots">
              <div className="space-y-2">
                {interview.scheduling_slots.map((slot, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2.5 rounded-lg border border-slate-200 p-3 hover:border-indigo-200 hover:bg-indigo-50/30 transition-colors"
                  >
                    <CalendarDaysIcon className="h-4 w-4 text-indigo-500 shrink-0" />
                    <span className="text-sm text-slate-700">{slot}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
