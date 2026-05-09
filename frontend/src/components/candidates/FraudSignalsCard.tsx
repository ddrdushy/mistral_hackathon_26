"use client";

import { useCallback, useEffect, useState } from "react";
import { ExclamationTriangleIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
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

export default function FraudSignalsCard({
  appId,
  isOwner,
  onChanged,
}: {
  appId: number;
  isOwner: boolean;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<FraudResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  if (data.fraud_flags_count === 0) return null; // clean — no card

  const submitOverride = async () => {
    if (reason.trim().length < 10) {
      setError("Reason must be at least 10 characters");
      return;
    }
    try {
      setBusy(true);
      setError(null);
      await apiPost(`/applications/${appId}/fraud-override`, { reason: reason.trim() });
      setOverrideOpen(false);
      setReason("");
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
