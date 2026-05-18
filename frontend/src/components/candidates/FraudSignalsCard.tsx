"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ExclamationTriangleIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import Card from "@/components/ui/Card";
import { apiGet, apiPost } from "@/lib/api";

interface FraudSignal {
  id: number;
  signal_type: string;
  severity: "low" | "medium" | "high" | "critical";
  evidence: Record<string, unknown>;
  detected_at: string | null;
}

interface FraudResponse {
  fraud_score: number;
  fraud_flags_count: number;
  fraud_blocked: boolean;
  fraud_overridden_at: string | null;
  fraud_override_reason: string;
  signals: FraudSignal[];
}

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-rose-100 text-rose-700",
  high: "bg-amber-100 text-amber-700",
  medium: "bg-yellow-100 text-yellow-700",
  low: "bg-slate-100 text-slate-600",
};

const SIGNAL_LABEL: Record<string, string> = {
  hidden_text_color: "Hidden text (font ≈ background)",
  microtext: "Microtext (font < 4pt)",
  offpage_text: "Off-page text",
  transparent_text: "Transparent text",
  behind_image: "Text behind image",
  prompt_injection: "Prompt injection attempt",
  duplicate_content_glyph: "Duplicate content via glyph",
};

// Risk strings the resume scorer emits that we want to surface in the
// fraud card. Anything in this list gets a friendly label + explanation;
// other risks render verbatim.
const SCORER_RISK_LABELS: Record<string, { label: string; hint: string }> = {
  not_a_resume: {
    label: "Uploaded file isn't a résumé",
    hint:
      "The content didn't look like a CV (job description, blank page, marketing PDF, etc.). The scorer skipped grading and returned 0/100.",
  },
  no_cv_uploaded: {
    label: "No CV uploaded",
    hint:
      "This candidate has no attached CV to score. Ask them to send one or upload manually before re-scoring.",
  },
  empty_resume_text: {
    label: "Resume text couldn't be extracted",
    hint:
      "Likely an image-only PDF, scan, or corrupt file. Try uploading a text-selectable version or run OCR.",
  },
};

export default function FraudSignalsCard({
  appId,
  isOwner,
  onChanged,
  scorerRisks,
}: {
  appId: number;
  isOwner: boolean;
  onChanged?: () => void;
  /** Risk strings from `application.resume_score_json.risks`. Surfaced
   *  here so the "Fraud signals" action link in the page header isn't
   *  a dead link when the scorer rejected the upload for non-PDF reasons
   *  (e.g. not_a_resume). */
  scorerRisks?: string[];
}) {
  const [data, setData] = useState<FraudResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scoringNote, setScoringNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiGet<FraudResponse>(`/applications/${appId}/fraud-signals`);
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !data) return null;

  // Filter scorer risks down to actionable ones — drop placeholder
  // "no risks identified" strings the scorer pads its output with so
  // we don't render misleading rows in the empty state.
  const meaningfulRisks = (scorerRisks ?? []).filter((r) => {
    const v = (r || "").toLowerCase().trim();
    if (!v) return false;
    if (v.includes("no significant")) return false;
    if (v === "none" || v === "n/a") return false;
    return true;
  });

  if (data.fraud_flags_count === 0) {
    // Render a friendly empty state instead of swallowing the section.
    // The "Fraud signals" anchor in the action bar is unconditional, so
    // hiding entirely makes the click feel broken. We also surface any
    // resume-scorer risks here so non-PDF rejections (not_a_resume,
    // no_cv_uploaded, etc.) have a visible home.
    return (
      <Card title="Resume fraud check">
        <div className="rounded-md border bg-emerald-50 border-emerald-200 px-4 py-3 mb-3 flex items-start gap-3">
          <ShieldCheckIcon className="h-5 w-5 flex-shrink-0 mt-0.5 text-emerald-600" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-emerald-900">
              No adversarial content detected
            </p>
            <p className="text-xs text-emerald-800/80 mt-0.5">
              We didn&apos;t find hidden text, microtext, off-page text,
              prompt-injection phrases, or invisible Unicode in this CV.
            </p>
          </div>
        </div>

        {meaningfulRisks.length > 0 && (
          <>
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
              Flagged by the résumé scorer
            </p>
            <ul className="divide-y divide-slate-100 text-sm">
              {meaningfulRisks.map((r, i) => {
                const key = (r || "").toLowerCase().trim();
                const info = SCORER_RISK_LABELS[key];
                return (
                  <li key={`${key}-${i}`} className="py-2.5 flex items-start gap-3">
                    <ExclamationTriangleIcon className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-600" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800">
                        {info?.label || r}
                      </p>
                      {info?.hint && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          {info.hint}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    );
  }

  const submitOverride = async () => {
    if (reason.trim().length < 10) {
      setError("Reason must be at least 10 characters");
      return;
    }
    try {
      setBusy(true);
      setError(null);
      setScoringNote(null);
      const res = await apiPost<{ scoring_error?: string; resume_score?: number }>(
        `/applications/${appId}/fraud-override`,
        { reason: reason.trim() },
      );
      setOverrideOpen(false);
      setReason("");
      if (res?.scoring_error) {
        setScoringNote(
          `Override applied, but scoring failed: ${res.scoring_error}. Try Rescore once attachments refresh.`,
        );
      } else if (typeof res?.resume_score === "number") {
        setScoringNote(`Override applied. Resume re-scored: ${res.resume_score}/100.`);
      } else {
        setScoringNote("Override applied. Resume re-scored.");
      }
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Override failed");
    } finally {
      setBusy(false);
    }
  };

  const blocked = data.fraud_blocked;
  const overridden = !!data.fraud_overridden_at;

  return (
    <Card title="Resume fraud check">
      <div
        className={`rounded-md border px-4 py-3 mb-3 ${
          blocked
            ? "bg-rose-50 border-rose-300 text-rose-900"
            : overridden
            ? "bg-amber-50 border-amber-200 text-amber-900"
            : "bg-amber-50 border-amber-200 text-amber-900"
        }`}
      >
        <div className="flex items-start gap-3">
          {blocked ? (
            <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0 mt-0.5 text-rose-600" />
          ) : overridden ? (
            <ShieldCheckIcon className="h-5 w-5 flex-shrink-0 mt-0.5 text-amber-600" />
          ) : (
            <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0 mt-0.5 text-amber-600" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">
              {blocked
                ? "Scoring blocked — adversarial content detected"
                : overridden
                ? "Block manually overridden"
                : "Suspicious content detected"}
            </p>
            <p className="text-xs mt-0.5">
              Fraud score <strong className="tabular-nums">{data.fraud_score}/100</strong>
              {" · "}
              {data.fraud_flags_count} flag{data.fraud_flags_count === 1 ? "" : "s"}
              {blocked && " · LLM scorer skipped"}
              {overridden && data.fraud_override_reason && (
                <> · Reason: <em>{data.fraud_override_reason}</em></>
              )}
            </p>
          </div>
          {blocked && isOwner && (
            <button
              type="button"
              onClick={() => setOverrideOpen(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-md bg-white border border-rose-300 text-rose-700 hover:bg-rose-100"
            >
              Override and score
            </button>
          )}
        </div>
        {scoringNote && (
          <div className="mt-2 text-xs px-3 py-2 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800">
            {scoringNote}
          </div>
        )}
      </div>

      <ul className="divide-y divide-slate-100 text-sm">
        {data.signals.map((s) => (
          <li key={s.id} className="py-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold ${
                  SEVERITY_BADGE[s.severity] || SEVERITY_BADGE.low
                }`}
              >
                {s.severity}
              </span>
              <span className="text-sm font-medium text-slate-800">
                {SIGNAL_LABEL[s.signal_type] || s.signal_type}
              </span>
            </div>
            <FraudEvidence evidence={s.evidence} />
          </li>
        ))}
      </ul>

      {overrideOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50"
          onClick={() => setOverrideOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900">
                Override fraud block
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                The LLM scorer will run on this resume. The override + reason
                are recorded in your audit log.
              </p>
            </div>
            <div className="px-6 py-4">
              <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                Reason (required)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                placeholder="e.g. Reviewed PDF manually — light-grey watermark misread as hidden text. Resume is clean."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y"
                minLength={10}
                maxLength={2000}
              />
              {error && (
                <p className="mt-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                  {error}
                </p>
              )}
            </div>
            <div className="px-6 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOverrideOpen(false)}
                className="px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-md"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitOverride}
                disabled={busy || reason.trim().length < 10}
                className="px-3 py-1.5 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-md disabled:opacity-50"
              >
                {busy ? "Overriding..." : "Override block"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function FraudEvidence({ evidence }: { evidence: Record<string, unknown> }) {
  const matched = (evidence.matched as string) || (evidence.text as string) || "";
  const snippet = (evidence.snippet as string) || "";
  const fontColor = evidence.font_color as string | undefined;
  const fontSize = evidence.font_size as number | undefined;
  const page = evidence.page as number | undefined;

  return (
    <div className="mt-1.5 text-xs text-slate-600">
      {matched && (
        <p className="bg-slate-50 border border-slate-200 rounded px-2 py-1 font-mono break-all">
          {`"${matched.length > 200 ? matched.slice(0, 200) + "…" : matched}"`}
        </p>
      )}
      {snippet && snippet !== matched && (
        <p className="mt-1 text-slate-500 italic">…{snippet}…</p>
      )}
      <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
        {fontColor && (
          <span>
            colour <code className="font-mono">{fontColor}</code>
          </span>
        )}
        {fontSize !== undefined && <span>size {fontSize}pt</span>}
        {page !== undefined && <span>page {page}</span>}
      </div>
    </div>
  );
}
