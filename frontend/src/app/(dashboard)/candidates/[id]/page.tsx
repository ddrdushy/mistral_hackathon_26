"use client";

import { use, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { apiGet, apiPost, apiPatch, apiDelete, apiUrl } from "@/lib/api";
import FraudSignalsCard from "@/components/candidates/FraudSignalsCard";
import FraudHighlights from "@/components/candidates/FraudHighlights";
import HrVideoPanel from "@/components/candidates/HrVideoPanel";
import SlotPicker from "@/components/scheduling/SlotPicker";
import OfferCard from "@/components/offers/OfferCard";
import { useAuth } from "@/components/auth/AuthGate";
import TagChip, { TagSummary } from "@/components/tags/TagChip";
import TagPicker from "@/components/tags/TagPicker";
import {
  PIPELINE_STAGES,
  STAGE_COLORS,
  STAGE_LABELS,
  RECOMMENDATION_COLORS,
  scoreColor,
  scoreBg,
  timeAgo,
} from "@/lib/constants";
import type { Application, Candidate, InterviewLink, HiringReport } from "@/types/index";
import ScoreGauge from "@/components/viz/ScoreGauge";
import RadialMeter from "@/components/viz/RadialMeter";
import RoundBars from "@/components/viz/RoundBars";
import PipelineStepper from "@/components/viz/PipelineStepper";
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
  const { me } = useAuth();
  const isOwner = me?.user?.role === "owner";

  const [app, setApp] = useState<Application | null>(null);
  // Candidate is loaded independently so we can still render a useful
  // page (with name/email/CV download/Match-to-job CTA) when the
  // candidate exists but has no Application yet — the common case for
  // anyone uploaded directly to the talent bank.
  const [candidate, setCandidate] = useState<Candidate | null>(null);

  // Application id resolved after fetch. Used by every action handler
  // below — keeps us from accidentally routing /applications/{candidate_id}
  // calls into the API again.
  const appId = app?.id ?? Number(id);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Action loading states
  const [stageLoading, setStageLoading] = useState(false);
  const [evaluateLoading, setEvaluateLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Transcript collapse
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [aiReportOpen, setAiReportOpen] = useState(false);

  // Interview link
  const [linkLoading, setLinkLoading] = useState(false);
  const [interviewLink, setInterviewLink] = useState<InterviewLink | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // Hiring report
  const [hiringReport, setHiringReport] = useState<HiringReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  // Once the application has loaded, every action endpoint (stage,
  // rescore, screening, etc.) keys off this id — NOT the URL id, which
  // is a candidate id. We default to Number(id) only as a safety net
  // for the brief render before `app` arrives; in practice handlers
  // only fire after the user has interacted with the loaded page.

  // ── Fetch application data ───────────────────────────────────────────────

  const fetchApplication = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // The URL is /candidates/{id} (CANDIDATE id). Step 1: load the
      // candidate so we always have name/email/CV to render — even when
      // the candidate has no Application yet (talent-bank-only). Step 2:
      // look up the candidate's most recent application via the new
      // ?candidate_id= filter. Step 3: fall back to /applications/{id}
      // so legacy email deep-links (where {id} was actually an app id)
      // still resolve.
      let cand: Candidate | null = null;
      try {
        cand = await apiGet<Candidate>(`/candidates/${id}`);
      } catch {
        // candidate fetch can fail for old app-id deep-links; ignore
      }
      setCandidate(cand);

      let data: Application | null = null;
      try {
        const list = await apiGet<{ applications: Application[] }>(
          "/applications",
          {
            candidate_id: String(id),
            per_page: "1",
            sort_by: "updated_at",
            order: "desc",
          },
        );
        if (list.applications && list.applications.length > 0) {
          data = list.applications[0];
        }
      } catch {
        // fall through
      }
      if (!data && !cand) {
        // Neither a candidate nor an app id — legacy deep-link path.
        try {
          data = await apiGet<Application>(`/applications/${id}`);
        } catch {
          // surface as 404 below
        }
      }
      // It's OK for data to be null when cand is set — we render a
      // candidate-only view in that case.
      setApp(data);

      if (!data && !cand) {
        throw new Error("Candidate not found");
      }

      // Fetch existing interview links if link status exists. Use the
      // app id we just resolved, NOT the URL id, since /screening/{id}/links
      // also expects an application id. Skipped entirely in the no-app
      // (talent-bank-only) flow.
      if (data && data.interview_link_status && !["expired"].includes(data.interview_link_status)) {
        try {
          const links = await apiGet<{ links: InterviewLink[] }>(`/screening/${data.id}/links`);
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

  // Auto-fetch hiring report when application has resume score
  useEffect(() => {
    if (app && app.resume_score && !hiringReport && !reportLoading) {
      setReportLoading(true);
      apiGet<HiringReport>(`/screening/${appId}/hiring-report`)
        .then(setHiringReport)
        .catch(() => {/* silently fail */})
        .finally(() => setReportLoading(false));
    }
  }, [app, id, hiringReport, reportLoading]);

  // ── Stage change handler ─────────────────────────────────────────────────

  const handleStageChange = async (newStage: string) => {
    if (!app || newStage === app.stage) return;
    const prevStage = app.stage;
    setApp((prev) => (prev ? { ...prev, stage: newStage } : prev));
    setStageLoading(true);
    try {
      await apiPatch(`/applications/${appId}/stage`, { stage: newStage });
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
        app_id: appId,
      });
      setInterviewLink(result);
      await fetchApplication();
    } catch (err) {
      // Surface the actual API error — was previously swallowed as
      // "Failed to generate interview link." which hid plan-gate
      // failures (402), missing-job 404s, and ElevenLabs config
      // problems alike.
      alert(
        err instanceof Error
          ? `Failed to generate interview link: ${err.message}`
          : "Failed to generate interview link.",
      );
    } finally {
      setLinkLoading(false);
    }
  };

  // "Regenerate" buttons fire after a previous link expired — in that
  // flow HR has already decided the candidate should interview, so it's
  // surprising when clicking Regenerate quietly produces a new link
  // that the candidate never receives. This combined handler generates
  // AND immediately sends the email, then refreshes state.
  const handleRegenerateAndSend = async () => {
    setLinkLoading(true);
    try {
      const result = await apiPost<InterviewLink>("/screening/generate-link", {
        app_id: appId,
      });
      setInterviewLink(result);
      try {
        await apiPost("/screening/send-link", { token: result.token });
        setInterviewLink((prev) => prev ? { ...prev, status: "sent" } : prev);
      } catch (sendErr) {
        // Generate succeeded, send failed — surface the partial state so
        // the user can hit Send manually.
        alert(
          sendErr instanceof Error
            ? `New link generated, but the email failed to send: ${sendErr.message}`
            : "New link generated, but the email failed to send. Use Send to retry.",
        );
      }
      await fetchApplication();
    } catch {
      alert("Failed to regenerate interview link.");
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
      await apiPost("/screening/evaluate", { app_id: appId });
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
      await apiPost(`/screening/${appId}/book-slot`, { slot });
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
      await apiPost(`/screening/${appId}/send-draft`, {});
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
      await apiPost(`/screening/${appId}/calculate-final-score`, {});
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

  // ── No application yet (candidate-only view) ───────────────────────────
  // Talent-bank uploads exist as Candidate rows with zero Applications.
  // Render their profile + CV download + a "Match to a job" CTA so the
  // page is useful instead of dead-ending HR with "Application not found".

  if (!app && candidate) {
    const missing: string[] = [];
    if (candidate.email_missing) missing.push("email");
    if (candidate.phone_missing) missing.push("phone");
    return (
      <div className="space-y-5">
        <Link
          href="/candidates"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Candidates
        </Link>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                {candidate.name || "Untitled candidate"}
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                {!candidate.email_missing && candidate.email}
                {!candidate.email_missing && candidate.phone && " · "}
                {candidate.phone}
              </p>
              {missing.length > 0 && (
                <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-md text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200">
                  ⚠ Missing {missing.join(" + ")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {candidate.resume_blob_available && (
                <a
                  href={apiUrl(`/candidates/${candidate.id}/resume/file`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                >
                  ⤓ Download CV
                </a>
              )}
            </div>
          </div>

          {candidate.profile?.summary && (
            <p className="mt-4 text-sm text-slate-600 leading-relaxed">
              {candidate.profile.summary}
            </p>
          )}
          {candidate.profile?.skills && candidate.profile.skills.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {candidate.profile.skills.slice(0, 12).map((sk: string) => (
                <span
                  key={sk}
                  className="text-[11px] px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200"
                >
                  {sk}
                </span>
              ))}
            </div>
          )}

          <div className="mt-6 rounded-lg border border-indigo-200 bg-indigo-50/60 p-4">
            <h2 className="text-sm font-semibold text-indigo-900">
              No application yet
            </h2>
            <p className="text-xs text-indigo-800 mt-1 leading-relaxed">
              This candidate sits in your talent bank — they haven&apos;t been
              matched to an open job, so there&apos;s no scoring, interview,
              or pipeline data to show yet. Open a job and use
              <span className="font-semibold"> From your talent bank</span> to
              surface this candidate, or pick a job to attach them to.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/jobs"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700"
              >
                Browse jobs
              </Link>
              <Link
                href="/talent-bank"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white text-slate-700 border border-slate-300 hover:bg-slate-50"
              >
                Back to talent bank
              </Link>
            </div>
          </div>
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
              {error || "Candidate not found."}
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

            {/* Hand-applied tags */}
            {app.candidate_id && (
              <CandidateTagsRow candidateId={app.candidate_id} />
            )}

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

        {/* Quick-action toolbar — jumps to relevant card lower on the page
            so testers + users don't have to scroll the long detail view to
            find offers, calls, WhatsApp, fraud signals. */}
        {app && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-3">
            <a
              href="#offer-card"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-medium hover:bg-indigo-100 transition-colors"
            >
              <DocumentTextIcon className="w-4 h-4" />
              Generate offer
            </a>
            <a
              href="#call-queue-card"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200 transition-colors"
            >
              <PhoneIcon className="w-4 h-4" />
              Add to call queue
            </a>
            {app.candidate_phone && (
              <a
                href="#whatsapp-card"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 transition-colors"
              >
                <ChatBubbleLeftRightIcon className="w-4 h-4" />
                Send WhatsApp
              </a>
            )}
            <a
              href="#fraud-card"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 text-amber-800 text-xs font-medium hover:bg-amber-100 transition-colors"
            >
              <ShieldCheckIcon className="w-4 h-4" />
              Fraud signals
            </a>
            <Link
              href="/outreach"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200 transition-colors"
            >
              <EnvelopeIcon className="w-4 h-4" />
              Outreach sequences
            </Link>
            <Link
              href={`/candidates?match_for=${app.candidate_id ?? ""}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200 transition-colors"
            >
              <MagnifyingGlassIcon className="w-4 h-4" />
              Match to another job
            </Link>
          </div>
        )}
      </Card>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* RESULTS DASHBOARD — pipeline stepper + score gauges + integrity   */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <ResultsHero app={app} />

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* FULL-WIDTH: AI Autonomous Hiring Report (TOP OF PAGE)             */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {hiringReport && (
        <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-violet-50 overflow-hidden shadow-sm">
          {/* Report header (clickable to toggle) */}
          <button
            type="button"
            onClick={() => setAiReportOpen((v) => !v)}
            className="w-full bg-gradient-to-r from-indigo-600 via-indigo-700 to-violet-700 px-6 py-4 text-left hover:brightness-105 transition"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
                  <ShieldCheckIcon className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h2 className="text-white font-bold text-sm tracking-wide uppercase">
                    AI Autonomous Hiring Report
                  </h2>
                  <p className="text-indigo-200 text-xs mt-0.5">
                    {aiReportOpen ? "Click to collapse" : "Click to expand the full evaluation"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className={`px-3 py-1.5 rounded-full text-xs font-bold tracking-wide ${
                  hiringReport.hire_recommendation.includes("Strong Hire") ? "bg-green-400/20 text-green-100 ring-1 ring-green-400/40" :
                  hiringReport.hire_recommendation === "Hire" ? "bg-green-400/20 text-green-100 ring-1 ring-green-400/40" :
                  hiringReport.hire_recommendation === "Lean Hire" ? "bg-amber-400/20 text-amber-100 ring-1 ring-amber-400/40" :
                  "bg-red-400/20 text-red-100 ring-1 ring-red-400/40"
                }`}>
                  {hiringReport.hire_recommendation}
                </div>
                <div className="text-right">
                  <p className="text-indigo-200 text-[10px] uppercase tracking-wider">Confidence</p>
                  <p className="text-white font-bold text-lg tabular-nums leading-none">{hiringReport.confidence_pct}%</p>
                </div>
                <svg
                  className={`h-5 w-5 text-white/80 transition-transform ${aiReportOpen ? "rotate-180" : ""}`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.24 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
          </button>

          {aiReportOpen && (
          <div className="p-6 space-y-6">
            {/* Executive Summary */}
            <div>
              <p className="text-sm text-slate-700 leading-relaxed">
                {hiringReport.executive_summary}
              </p>
            </div>

            {/* Pipeline Actions Timeline */}
            <div>
              <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <ArrowPathIcon className="h-3.5 w-3.5" />
                What I Did Autonomously
              </h3>
              <div className="relative">
                <div className="absolute left-[11px] top-3 bottom-3 w-0.5 bg-indigo-200" />
                <div className="space-y-3">
                  {hiringReport.pipeline_actions.map((action, i) => (
                    <div key={i} className="flex items-start gap-3 relative">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 z-10 ${
                        i === hiringReport.pipeline_actions.length - 1
                          ? "bg-indigo-600 text-white"
                          : "bg-indigo-100 text-indigo-600"
                      }`}>
                        <CheckCircleSolid className="h-3.5 w-3.5" />
                      </div>
                      <div className="bg-white rounded-lg border border-slate-200 p-3 flex-1 shadow-sm">
                        <p className="text-xs font-bold text-slate-800">{action.action}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{action.detail}</p>
                        <p className="text-xs text-indigo-600 font-medium mt-1">→ {action.result}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Two columns: Strengths + Risks */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-green-50 rounded-lg border border-green-200 p-4">
                <h3 className="text-xs font-bold text-green-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <CheckCircleSolid className="h-3.5 w-3.5 text-green-600" />
                  Key Strengths
                </h3>
                <ul className="space-y-1.5">
                  {hiringReport.strengths_analysis.map((s, i) => (
                    <li key={i} className="text-xs text-green-800 flex items-start gap-2">
                      <span className="text-green-500 mt-0.5 shrink-0">✓</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-red-50 rounded-lg border border-red-200 p-4">
                <h3 className="text-xs font-bold text-red-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <ExclamationTriangleIcon className="h-3.5 w-3.5 text-red-600" />
                  Risks & Concerns
                </h3>
                <ul className="space-y-1.5">
                  {hiringReport.risk_analysis.map((r, i) => (
                    <li key={i} className="text-xs text-red-800 flex items-start gap-2">
                      <span className="text-red-400 mt-0.5 shrink-0">⚠</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Verdict */}
            <div className={`rounded-lg p-4 border-2 ${
              hiringReport.hire_recommendation.includes("Hire") && !hiringReport.hire_recommendation.includes("No")
                ? "bg-green-50 border-green-300"
                : hiringReport.hire_recommendation === "Lean Hire"
                ? "bg-amber-50 border-amber-300"
                : "bg-red-50 border-red-300"
            }`}>
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  hiringReport.hire_recommendation.includes("Hire") && !hiringReport.hire_recommendation.includes("No")
                    ? "bg-green-600"
                    : hiringReport.hire_recommendation === "Lean Hire"
                    ? "bg-amber-500"
                    : "bg-red-600"
                }`}>
                  {hiringReport.hire_recommendation.includes("Hire") && !hiringReport.hire_recommendation.includes("No")
                    ? <CheckCircleSolid className="h-5 w-5 text-white" />
                    : hiringReport.hire_recommendation === "Lean Hire"
                    ? <ExclamationTriangleIcon className="h-5 w-5 text-white" />
                    : <XCircleIcon className="h-5 w-5 text-white" />}
                </div>
                <div>
                  <h3 className={`text-sm font-bold ${
                    hiringReport.hire_recommendation.includes("Hire") && !hiringReport.hire_recommendation.includes("No")
                      ? "text-green-800"
                      : hiringReport.hire_recommendation === "Lean Hire"
                      ? "text-amber-800"
                      : "text-red-800"
                  }`}>
                    Final Verdict: {hiringReport.hire_recommendation}
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed mt-1">
                    {hiringReport.verdict_reasoning}
                  </p>
                </div>
              </div>
            </div>

            {/* Suggested Next Steps */}
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <LightBulbIcon className="h-3.5 w-3.5 text-indigo-500" />
                Suggested Next Steps
              </h3>
              <ol className="space-y-1.5">
                {hiringReport.suggested_next_steps.map((step, i) => (
                  <li key={i} className="text-xs text-slate-600 flex items-start gap-2">
                    <span className="bg-indigo-100 text-indigo-700 rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Footer */}
            <div className="pt-3 border-t border-indigo-100 flex items-center justify-between">
              <p className="text-[10px] text-slate-400">
                Report generated autonomously by HireOps AI — no human intervention required
              </p>
              <div className="flex items-center gap-1">
                <div className="w-4 h-4 rounded bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center">
                  <span className="text-white text-[8px] font-bold">H</span>
                </div>
                <span className="text-[10px] font-medium text-indigo-400">HireOps AI</span>
              </div>
            </div>
          </div>
          )}
        </div>
      )}

      {reportLoading && (
        <Card>
          <div className="flex items-center justify-center py-8 gap-3">
            <LoadingSpinner size="sm" />
            <p className="text-sm text-slate-500">Generating AI hiring report...</p>
          </div>
        </Card>
      )}

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

                {/* Round 2 Interview Room Link */}
                {app.interview_room_url && (
                  <div className="mt-3 bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <PlayIcon className="h-4 w-4 text-indigo-600 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-indigo-600 uppercase">Round 2 Interview Room</p>
                          <p className="text-xs text-indigo-500 truncate">{app.interview_room_url}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={async () => {
                            await navigator.clipboard.writeText(app.interview_room_url!);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-100 transition-colors"
                        >
                          <ClipboardDocumentIcon className="h-3.5 w-3.5" />
                          {copied ? "Copied!" : "Copy"}
                        </button>
                        <a
                          href={app.interview_room_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                        >
                          <PlayIcon className="h-3.5 w-3.5" />
                          Join
                        </a>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-indigo-500 flex items-center gap-1">
                      <LightBulbIcon className="h-3 w-3" />
                      AI bot will join to transcribe and summarize the conversation
                    </p>
                  </div>
                )}
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
            <Card
              title="Resume Score"
              action={
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await apiPost(`/applications/${appId}/rescore`, {});
                      await fetchApplication();
                    } catch (err) {
                      alert(err instanceof Error ? err.message : "Re-score failed");
                    }
                  }}
                  className="text-xs font-medium px-3 py-1.5 rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                >
                  Re-score
                </button>
              }
            >
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

                {/* Blocked-for-fraud callout — when the scorer refuses to
                    grade an adversarial resume, the other arrays are absent.
                    Render the reason instead of crashing on .length below. */}
                {("blocked_reason" in resume) && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
                    <div className="text-sm font-semibold text-rose-900">
                      Scoring blocked
                    </div>
                    <div className="text-xs text-rose-800 mt-0.5">
                      {resume.summary || "The resume contained adversarial content. Score was not generated."}
                    </div>
                  </div>
                )}

                {/* Evidence */}
                {(resume.evidence?.length ?? 0) > 0 && (
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
                {(resume.gaps?.length ?? 0) > 0 && (
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
                {(resume.risks?.length ?? 0) > 0 && (
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
                {(resume.screening_questions?.length ?? 0) > 0 && (
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
                {(interview.strengths?.length ?? 0) > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                      <CheckCircleSolid className="h-4 w-4 text-green-500" />
                      Strengths
                    </h4>
                    <ul className="space-y-1.5">
                      {(interview.strengths ?? []).map((item, i) => (
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
                {(interview.concerns?.length ?? 0) > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                      <XCircleIcon className="h-4 w-4 text-red-500" />
                      Concerns
                    </h4>
                    <ul className="space-y-1.5">
                      {(interview.concerns ?? []).map((item, i) => (
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
                    {/* Expired → Regenerate AND auto-send the email */}
                    {interviewLink.status === "expired" && (
                      <Button size="sm" onClick={handleRegenerateAndSend} loading={linkLoading}>
                        <ArrowPathIcon className="h-4 w-4" />
                        Regenerate &amp; send
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
                  <Button size="sm" onClick={handleRegenerateAndSend} loading={linkLoading} className="w-full justify-center">
                    <ArrowPathIcon className="h-4 w-4" />
                    Regenerate &amp; send
                  </Button>
                )}
              </div>
            )}

            {/* Slot suggester — surface clash-free interview times pulled
                from the recruiter's Google Calendar when scheduling is
                still pending. Hidden once the interview is already
                completed/scheduled so it doesn't clutter that view. */}
            {app.stage !== "screened" &&
              app.stage !== "shortlisted" &&
              app.stage !== "rejected" &&
              !app.scheduled_interview_at && (
              <div className="mb-4">
                <SlotPicker durationMinutes={30} daysAhead={5} />
              </div>
            )}

            {/* HR-led video interview — recruiter joins the same room
                as the candidate (token-derived Jitsi). Only show for jobs
                explicitly set to hr_video mode. */}
            {app.interview_mode === "hr_video" && (
              <div className="mb-4">
                <HrVideoPanel
                  applicationId={appId}
                  interviewToken={interviewLink?.token || null}
                  hasExistingScore={!!interview}
                  onScored={fetchApplication}
                />
              </div>
            )}

            {/* Reschedule outcomes — three states the auto-reschedule
                pipeline can land on. We render distinct messaging for each
                so HR knows exactly whether there's an action to take. */}
            {app.screening_status === "rescheduled_auto_sent" && (
              <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-start gap-3">
                  <ArrowPathIcon className="w-5 h-5 text-emerald-700 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-emerald-900">
                      Interview auto-rescheduled
                    </div>
                    <div className="text-xs text-emerald-800 mt-0.5">
                      The candidate asked to do this later, so we generated a
                      fresh interview link and emailed it to them automatically.
                      No action needed — we&apos;ll evaluate the next attempt
                      when they complete it.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {app.screening_status === "reschedule_capped" && (
              <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-4">
                <div className="flex items-start gap-3">
                  <ClockIcon className="w-5 h-5 text-rose-700 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-rose-900">
                      Candidate has rescheduled multiple times
                    </div>
                    <div className="text-xs text-rose-800 mt-0.5">
                      We&apos;ve already auto-sent multiple fresh links and the
                      candidate keeps asking to reschedule. Worth reaching out
                      directly before another automatic send.
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={handleRegenerateAndSend}
                        loading={linkLoading}
                      >
                        <ArrowPathIcon className="h-4 w-4" />
                        Send another anyway
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Legacy: reschedule_requested without auto-resend (auto-send
                failed) — keep the manual-action banner so HR can recover. */}
            {(app.interview_link_status === "reschedule_requested" ||
              app.screening_status === "reschedule_requested") && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-start gap-3">
                  <ClockIcon className="w-5 h-5 text-amber-700 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-amber-900">
                      Candidate requested to reschedule
                    </div>
                    <div className="text-xs text-amber-800 mt-0.5">
                      We tried to auto-send a fresh link but couldn&apos;t reach
                      the candidate&apos;s mailbox.{" "}
                      {app.ai_next_action && (
                        <span className="block mt-1 font-mono text-[11px] text-amber-700">
                          {app.ai_next_action}
                        </span>
                      )}
                    </div>
                    <div className="mt-3">
                      <Button
                        size="sm"
                        onClick={handleRegenerateAndSend}
                        loading={linkLoading}
                      >
                        <ArrowPathIcon className="h-4 w-4" />
                        Generate &amp; resend link
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Interview Recording — show whenever we have audio, regardless
                of whether the candidate's link-status column was updated
                (an earlier bug left interview_link_status stuck on
                "interview_started" even after ElevenLabs delivered the
                transcript via webhook). We show audio if the interview link
                row itself is completed OR if a transcript exists. */}
            {(app.interview_link_status === "interview_completed" ||
              interviewLink?.status === "interview_completed" ||
              !!app.screening_transcript) &&
              interview?.mode !== "qa" &&
              app.interview_link_status !== "reschedule_requested" && (
                <div className="mb-4">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Interview Recording</p>
                  <audio
                    controls
                    className="w-full"
                    src={`${process.env.NEXT_PUBLIC_API_URL || "/api/v1"}/screening/${app.id}/audio`}
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
                {(snippets.why_shortlisted?.length ?? 0) > 0 && (
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
                {(snippets.key_strengths?.length ?? 0) > 0 && (
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
                {(snippets.main_gaps?.length ?? 0) > 0 && (
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
                {(snippets.interview_focus?.length ?? 0) > 0 && (
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


          {/* ── Offer letter ──────────────────────────────────────────────── */}
          {app && (
            <div id="offer-card" className="scroll-mt-20">
              <OfferCard
                applicationId={appId}
                candidateName={app.candidate_name}
                jobTitle={app.job_title}
                candidateEmail={app.candidate_email}
                gateReason={
                  app.stage === "shortlisted"
                    ? null
                    : app.stage === "rejected"
                      ? "This candidate was rejected — offers are disabled. Move them back into the pipeline first."
                      : "Offers unlock once the candidate has finished their interview and been moved to Shortlisted."
                }
              />
            </div>
          )}

          {/* ── Resume fraud check ─────────────────────────────────────────── */}
          {app && (
            <div id="fraud-card" className="scroll-mt-20 space-y-4">
              <FraudHighlights applicationId={appId} />
              <FraudSignalsCard
                appId={appId}
                isOwner={isOwner}
                onChanged={fetchApplication}
              />
            </div>
          )}

          {/* ── Send WhatsApp ──────────────────────────────────────────────── */}
          {app?.candidate_id && (
            <div id="whatsapp-card" className="scroll-mt-20">
              <SendWhatsAppCard
                candidateId={app.candidate_id}
                candidateName={app.candidate_name}
                candidatePhone={app.candidate_phone}
                onSent={fetchApplication}
              />
            </div>
          )}

          {/* ── Phone queue (schedule + recent calls) ──────────────────────── */}
          {app?.candidate_id && (
            <div id="call-queue-card" className="scroll-mt-20">
              <CallQueueCard
                candidateId={app.candidate_id}
                candidatePhone={app.candidate_phone}
                appId={app.id}
              />
            </div>
          )}

          {/* ── History timeline + CV versions ─────────────────────────────── */}
          {app?.candidate_id && (
            <CandidateHistoryCards candidateId={app.candidate_id} />
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

// ── Results hero: pipeline + score gauges + round bars + integrity stats ──

function ResultsHero({ app }: { app: Application }) {
  const interview = app.interview_score_json;
  const isQa = interview?.mode === "qa";
  const rounds = isQa
    ? [
        {
          label: "Aptitude",
          score: interview?.rounds?.aptitude?.score ?? null,
          weight: 0.25,
        },
        {
          label: "Reasoning",
          score: interview?.rounds?.reasoning?.score ?? null,
          weight: 0.3,
        },
        {
          label: "Technical",
          score: interview?.rounds?.technical?.score ?? null,
          weight: 0.45,
        },
      ]
    : [];

  const facePct = app.interview_face_tracking_json?.face_present_percentage ?? null;
  const attention =
    app.interview_face_tracking_json?.avg_attention_score != null
      ? app.interview_face_tracking_json.avg_attention_score * 100
      : null;
  const fraud = app.qa_fraud_risk_score ?? null;

  const thresholds = app.thresholds || {
    resume_min: 80,
    interview_min: 75,
    reject_below: 50,
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-5">
      {/* Pipeline */}
      <div>
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
          Pipeline progress
        </p>
        <PipelineStepper stage={app.stage} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-1">
        {/* Score gauges */}
        <div className="lg:col-span-7">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Scores
          </p>
          <div className="grid grid-cols-3 gap-3">
            <ScoreGauge
              value={app.resume_score}
              threshold={thresholds.resume_min}
              label="Resume"
              size={130}
            />
            <ScoreGauge
              value={app.interview_score}
              threshold={thresholds.interview_min}
              label="Interview"
              size={130}
            />
            <ScoreGauge
              value={app.final_score}
              threshold={thresholds.reject_below}
              label="Final"
              size={130}
            />
          </div>
          <p className="mt-3 text-[11px] text-slate-400 text-center">
            Dot = decision threshold
          </p>
        </div>

        {/* Q&A round breakdown OR integrity meter */}
        <div className="lg:col-span-5 lg:border-l lg:border-slate-100 lg:pl-5">
          {isQa ? (
            <>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
                Q&A round scores
              </p>
              <RoundBars rounds={rounds} />
            </>
          ) : (
            <>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
                Recommendation
              </p>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold capitalize ${
                    app.recommendation === "advance"
                      ? "bg-emerald-50 text-emerald-700"
                      : app.recommendation === "reject"
                        ? "bg-red-50 text-red-700"
                        : app.recommendation === "hold"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {app.recommendation || "pending"}
                </span>
              </div>
              {app.ai_next_action && (
                <p className="mt-3 text-xs text-slate-600 leading-relaxed">
                  {app.ai_next_action}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Integrity strip — shown when we have any signals */}
      {(fraud != null || facePct != null || attention != null) && (
        <div className="border-t border-slate-100 pt-4">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Interview integrity
          </p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
            {fraud != null && (
              <div className="md:col-span-1">
                <RadialMeter value={fraud} label="Fraud risk" size={130} />
              </div>
            )}
            <div className={`md:col-span-${fraud != null ? 3 : 4} grid grid-cols-2 sm:grid-cols-4 gap-2`}>
              <HeroStat
                label="Face Present"
                value={facePct != null ? `${Math.round(facePct)}%` : "—"}
                warn={facePct != null && facePct < 80}
              />
              <HeroStat
                label="Attention"
                value={attention != null ? `${Math.round(attention)}%` : "—"}
                warn={attention != null && attention < 60}
              />
              <HeroStat
                label="Tab / blur"
                value={app.qa_signals_summary?.summary?.focus_loss_count ?? "—"}
                warn={
                  (app.qa_signals_summary?.summary?.focus_loss_count ?? 0) > 1
                }
              />
              <HeroStat
                label="Pastes"
                value={app.qa_signals_summary?.summary?.paste_count ?? "—"}
                sub={
                  app.qa_signals_summary?.summary?.paste_chars
                    ? `${app.qa_signals_summary.summary.paste_chars} chars`
                    : undefined
                }
                warn={
                  (app.qa_signals_summary?.summary?.paste_chars ?? 0) > 200
                }
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HeroStat({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string | number;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-center border border-slate-100">
      <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
        {label}
      </p>
      <p
        className={`mt-0.5 text-base font-bold tabular-nums ${
          warn ? "text-red-600" : "text-slate-800"
        }`}
      >
        {value}
      </p>
      {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
    </div>
  );
}

function SendWhatsAppCard({
  candidateId,
  candidateName,
  candidatePhone,
  onSent,
}: {
  candidateId: number;
  candidateName: string;
  candidatePhone: string | null;
  onSent: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "err"; msg: string } | null>(null);

  const phoneOk = (candidatePhone ?? "").trim().length > 0;

  const send = async () => {
    if (!body.trim()) return;
    try {
      setBusy(true);
      setResult(null);
      await apiPost("/communications/whatsapp", {
        candidate_id: candidateId,
        body: body.trim(),
      });
      setBody("");
      setResult({ tone: "ok", msg: `WhatsApp sent to ${candidatePhone}` });
      onSent();
    } catch (err) {
      setResult({
        tone: "err",
        msg: err instanceof Error ? err.message : "Send failed",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Send WhatsApp">
      {!phoneOk ? (
        <p className="text-sm text-slate-500">
          Add a phone number to {candidateName}&apos;s record before sending
          WhatsApp.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-slate-500">
            To: <span className="font-mono text-slate-700">{candidatePhone}</span>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={`Hi ${candidateName.split(" ")[0]}, ...`}
            rows={4}
            maxLength={1600}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-400">
              {body.length} / 1600
            </span>
            <button
              onClick={send}
              disabled={busy || !body.trim()}
              className="px-3 py-1.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-50"
            >
              {busy ? "Sending..." : "Send WhatsApp"}
            </button>
          </div>
          {result && (
            <p
              className={`text-xs rounded-md px-3 py-2 ${
                result.tone === "ok"
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                  : "bg-rose-50 text-rose-800 border border-rose-200"
              }`}
            >
              {result.msg}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function CandidateTagsRow({ candidateId }: { candidateId: number }) {
  const [tags, setTags] = useState<TagSummary[]>([]);

  const reload = useCallback(async () => {
    try {
      const data = await apiGet<{ tags: TagSummary[] }>(
        `/candidates/${candidateId}`,
      );
      setTags(data.tags ?? []);
    } catch {
      setTags([]);
    }
  }, [candidateId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const addTag = async (tag: TagSummary) => {
    await apiPost(`/candidates/${candidateId}/tags`, { tag_ids: [tag.id] });
    reload();
  };
  const removeTag = async (tagId: number) => {
    await apiDelete(`/candidates/${candidateId}/tags/${tagId}`);
    reload();
  };

  return (
    <div className="mt-3 flex flex-wrap gap-1.5 items-center">
      {tags.map((t) => (
        <TagChip key={t.id} tag={t} onRemove={() => removeTag(t.id)} />
      ))}
      <TagPicker applied={tags} onAdd={addTag} onCreateAndAdd={addTag} />
    </div>
  );
}

interface QueuedCall {
  id: number;
  candidate_id: number;
  app_id: number | null;
  purpose: string;
  status: string;
  scheduled_for: string | null;
  attempted_at: string | null;
  completed_at: string | null;
  to_phone: string;
  twilio_call_sid: string;
  transcript: string;
  outcome: string;
  outcome_details: Record<string, unknown>;
  retry_count: number;
  last_error: string;
  rescheduled_to_id: number | null;
  created_at: string | null;
}

const PURPOSES: Array<{ id: string; label: string }> = [
  { id: "screening", label: "Screening" },
  { id: "reschedule", label: "Reschedule" },
  { id: "reminder", label: "Reminder" },
  { id: "availability_check", label: "Availability check" },
  { id: "custom", label: "Custom" },
];

function CallQueueCard({
  candidateId,
  candidatePhone,
  appId,
}: {
  candidateId: number;
  candidatePhone: string | null;
  appId?: number;
}) {
  const [calls, setCalls] = useState<QueuedCall[] | null>(null);
  const [purpose, setPurpose] = useState("screening");
  const [scheduledFor, setScheduledFor] = useState("");
  const [scriptPrompt, setScriptPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "err"; msg: string } | null>(null);

  const phoneOk = (candidatePhone ?? "").trim().length > 0;

  const fetchCalls = useCallback(async () => {
    try {
      const data = await apiGet<{ calls: QueuedCall[] }>(
        `/calls?candidate_id=${candidateId}&limit=20`,
      );
      setCalls(data.calls ?? []);
    } catch {
      setCalls([]);
    }
  }, [candidateId]);

  useEffect(() => {
    fetchCalls();
  }, [fetchCalls]);

  const enqueue = async (callNow: boolean) => {
    if (!phoneOk) return;
    try {
      setBusy(true);
      setResult(null);
      const body: Record<string, unknown> = {
        candidate_id: candidateId,
        purpose,
        script_prompt: scriptPrompt.trim(),
      };
      if (appId) body.app_id = appId;
      if (!callNow && scheduledFor) {
        // datetime-local is local time; send as UTC ISO
        body.scheduled_for = new Date(scheduledFor).toISOString();
      }
      await apiPost("/calls", body);
      setScheduledFor("");
      setScriptPrompt("");
      setResult({
        tone: "ok",
        msg: callNow
          ? "Queued — worker will dial within ~30s."
          : `Scheduled for ${new Date(scheduledFor).toLocaleString()}`,
      });
      fetchCalls();
    } catch (err) {
      setResult({
        tone: "err",
        msg: err instanceof Error ? err.message : "Queue failed",
      });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: number) => {
    if (!confirm("Cancel this scheduled call?")) return;
    try {
      await apiPost(`/calls/${id}/cancel`);
      fetchCalls();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Cancel failed");
    }
  };

  return (
    <Card title="Phone Queue">
      {!phoneOk ? (
        <p className="text-sm text-slate-500">
          Add a phone number to this candidate before scheduling a call.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-slate-500">
            Will call: <span className="font-mono text-slate-700">{candidatePhone}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                Purpose
              </label>
              <select
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {PURPOSES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                Schedule for{" "}
                <span className="text-slate-400 normal-case">(blank = ASAP)</span>
              </label>
              <input
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>
          <textarea
            value={scriptPrompt}
            onChange={(e) => setScriptPrompt(e.target.value)}
            placeholder="Optional: notes / prompt for the AI agent (e.g. 'Confirm Tuesday 3pm slot, ask about availability through November')"
            rows={2}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => enqueue(true)}
              disabled={busy}
              className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50"
            >
              {busy ? "Queueing..." : "Call now"}
            </button>
            <button
              onClick={() => enqueue(false)}
              disabled={busy || !scheduledFor}
              className="px-3 py-1.5 text-sm font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-md disabled:opacity-50"
            >
              Schedule
            </button>
          </div>
          {result && (
            <p
              className={`text-xs rounded-md px-3 py-2 ${
                result.tone === "ok"
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                  : "bg-rose-50 text-rose-800 border border-rose-200"
              }`}
            >
              {result.msg}
            </p>
          )}

          {calls && calls.length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                Recent calls ({calls.length})
              </p>
              <ul className="space-y-1.5 text-sm">
                {calls.slice(0, 8).map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50"
                  >
                    <span
                      className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        c.status === "completed"
                          ? "bg-emerald-100 text-emerald-700"
                          : c.status === "failed"
                          ? "bg-rose-100 text-rose-700"
                          : c.status === "cancelled" || c.status === "rescheduled"
                          ? "bg-slate-100 text-slate-600"
                          : c.status === "in_progress"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-indigo-100 text-indigo-700"
                      }`}
                    >
                      {c.status.replace("_", " ")}
                    </span>
                    <span className="text-xs text-slate-600 capitalize">
                      {c.purpose.replace("_", " ")}
                    </span>
                    <span className="text-xs text-slate-400 ml-auto flex-shrink-0">
                      {c.scheduled_for ? new Date(c.scheduled_for).toLocaleString() : ""}
                    </span>
                    {c.status === "pending" && (
                      <button
                        onClick={() => cancel(c.id)}
                        className="text-xs text-rose-600 hover:text-rose-800 ml-1"
                      >
                        Cancel
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

interface TimelineItem {
  type: string;
  at: string | null;
  label: string;
  meta?: Record<string, unknown>;
  app_id?: number;
}

interface CvVersionRow {
  id: number | null;
  version_number: number;
  is_current: boolean;
  filename: string;
  source: string;
  uploaded_at: string | null;
  char_count: number;
  blob_available?: boolean;
}

function CandidateHistoryCards({ candidateId }: { candidateId: number }) {
  const [timeline, setTimeline] = useState<TimelineItem[] | null>(null);
  const [versions, setVersions] = useState<CvVersionRow[] | null>(null);
  const [openVersion, setOpenVersion] = useState<{ version_number: number; resume_text: string } | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const [tl, vs] = await Promise.all([
          apiGet<{ timeline: TimelineItem[] }>(`/candidates/${candidateId}/timeline`),
          apiGet<{ versions: CvVersionRow[] }>(`/candidates/${candidateId}/cv-versions`),
        ]);
        if (cancel) return;
        setTimeline(tl.timeline ?? []);
        setVersions(vs.versions ?? []);
      } catch {
        if (!cancel) {
          setTimeline([]);
          setVersions([]);
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [candidateId]);

  const viewVersion = async (id: number) => {
    try {
      const data = await apiGet<{ version_number: number; resume_text: string }>(
        `/candidates/${candidateId}/cv-versions/${id}/text`,
      );
      setOpenVersion(data);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to load version");
    }
  };

  return (
    <>
      <Card title={`CV History${versions ? ` (${versions.length})` : ""}`}>
        {!versions ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : versions.length === 0 ? (
          <p className="text-sm text-slate-500">No CV uploaded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {versions.map((v) => (
              <li
                key={`${v.version_number}-${v.id ?? "current"}`}
                className="py-2 flex items-center gap-3"
              >
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded ${
                    v.is_current
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  v{v.version_number}
                  {v.is_current && " · current"}
                </span>
                <span className="flex-1 truncate text-slate-700">
                  {v.filename || "(unnamed)"}
                </span>
                <span className="text-xs text-slate-500 flex-shrink-0">
                  {v.uploaded_at ? timeAgo(v.uploaded_at) : ""}
                </span>
                {v.blob_available && (
                  <a
                    href={
                      v.is_current
                        ? apiUrl(`/candidates/${candidateId}/resume/file`)
                        : apiUrl(`/candidates/${candidateId}/cv-versions/${v.id}/file`)
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                    title="Download original file"
                  >
                    Download
                  </a>
                )}
                {!v.is_current && v.id != null && (
                  <button
                    type="button"
                    onClick={() => viewVersion(v.id!)}
                    className="text-xs font-medium text-slate-500 hover:text-slate-800"
                  >
                    View text
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Activity Timeline${timeline ? ` (${timeline.length})` : ""}`}>
        {!timeline ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : timeline.length === 0 ? (
          <p className="text-sm text-slate-500">No activity yet.</p>
        ) : (
          <ol className="relative border-l-2 border-slate-200 pl-4 space-y-3">
            {[...timeline].reverse().map((it, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[19px] top-1.5 w-3 h-3 rounded-full bg-indigo-500 border-2 border-white" />
                <div className="text-sm text-slate-800">{it.label}</div>
                {it.at && (
                  <div className="text-xs text-slate-500 mt-0.5">
                    {timeAgo(it.at)}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>

      {openVersion && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50"
          onClick={() => setOpenVersion(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-3xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-3 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">
                CV v{openVersion.version_number}
              </h2>
              <button
                onClick={() => setOpenVersion(null)}
                className="text-slate-500 hover:text-slate-800"
              >
                ✕
              </button>
            </div>
            <pre className="px-6 py-4 overflow-y-auto whitespace-pre-wrap text-xs font-mono text-slate-800 flex-1">
              {openVersion.resume_text || "(empty)"}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}

