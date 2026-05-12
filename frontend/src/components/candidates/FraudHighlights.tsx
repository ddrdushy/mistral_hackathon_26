"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import {
  ShieldExclamationIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@heroicons/react/24/outline";

interface SignalMarker {
  marker: number;
  signal_id: number;
  signal_type: string;
  severity: "critical" | "high" | "medium" | "low";
  bbox_px: [number, number, number, number];
  evidence_text: string;
}

interface FraudPage {
  page: number;
  width_px: number;
  height_px: number;
  image_b64: string;
  signal_markers: SignalMarker[];
}

interface TextOnlySignal {
  id: number;
  signal_type: string;
  severity: "critical" | "high" | "medium" | "low";
  evidence: Record<string, unknown>;
}

interface FraudVisualResponse {
  filename: string;
  has_pdf: boolean;
  render_scale: number;
  pages: FraudPage[];
  text_only_signals: TextOnlySignal[];
  fraud_score: number;
  fraud_flags_count: number;
  fraud_blocked: boolean;
}

const SEVERITY_STYLES: Record<SignalMarker["severity"], { dot: string; pill: string; label: string }> = {
  critical: { dot: "bg-red-600",    pill: "bg-red-100 text-red-700",       label: "Critical" },
  high:     { dot: "bg-orange-600", pill: "bg-orange-100 text-orange-700", label: "High" },
  medium:   { dot: "bg-yellow-500", pill: "bg-yellow-100 text-yellow-800", label: "Medium" },
  low:      { dot: "bg-blue-600",   pill: "bg-blue-100 text-blue-700",     label: "Low" },
};

function humanizeSignalType(t: string): string {
  switch (t) {
    case "hidden_text_color": return "Hidden text colour";
    case "microtext":         return "Microtext (<4pt)";
    case "offpage_text":      return "Text positioned off the page";
    case "prompt_injection":  return "Prompt-injection phrase";
    case "invisible_unicode": return "Invisible Unicode characters";
    default: return t;
  }
}

export default function FraudHighlights({ applicationId }: { applicationId: number }) {
  const [data, setData] = useState<FraudVisualResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiGet<FraudVisualResponse>(`/applications/${applicationId}/fraud-visual`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="text-sm text-slate-500">Loading fraud analysis…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-5">
        <div className="text-sm text-rose-700">Could not load fraud analysis: {error}</div>
      </div>
    );
  }

  if (!data) return null;
  if (data.fraud_score === 0 && data.fraud_flags_count === 0) return null;

  const allMarkers = data.pages.flatMap((p) =>
    p.signal_markers.map((m) => ({ ...m, page: p.page })),
  );

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 overflow-hidden">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full px-5 py-4 flex items-start gap-3 hover:bg-amber-100/40 text-left"
      >
        <ShieldExclamationIcon className="w-6 h-6 text-amber-700 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-amber-900">
              Fraud analysis
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-200 text-amber-900">
              Score {data.fraud_score} / 100
            </span>
            <span className="text-xs text-amber-800">
              {data.fraud_flags_count} signal{data.fraud_flags_count === 1 ? "" : "s"}
            </span>
            {data.fraud_blocked && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">
                Scoring blocked
              </span>
            )}
          </div>
          <div className="text-xs text-amber-800/80 mt-0.5">
            Visible highlights show exactly where on the CV each issue was detected.
            Click a marker number on the page or in the list to cross-reference.
          </div>
        </div>
        {collapsed ? (
          <ChevronDownIcon className="w-5 h-5 text-amber-700 flex-shrink-0" />
        ) : (
          <ChevronUpIcon className="w-5 h-5 text-amber-700 flex-shrink-0" />
        )}
      </button>

      {!collapsed && (
        <div className="border-t border-amber-200 bg-white p-5 space-y-5">
          {!data.has_pdf && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              The original CV is no longer available for rendering — the
              signals below were captured at upload time.
            </div>
          )}

          {/* Per-page annotated rasters */}
          {data.pages.length > 0 && (
            <div className="space-y-6">
              {data.pages.map((p) => (
                <div key={p.page}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Page {p.page}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {p.signal_markers.length} signal{p.signal_markers.length === 1 ? "" : "s"} on this page
                    </div>
                  </div>
                  <div
                    className="relative rounded-lg border border-slate-200 overflow-hidden bg-slate-50"
                    style={{ aspectRatio: `${p.width_px} / ${p.height_px}` }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`data:image/png;base64,${p.image_b64}`}
                      alt={`Page ${p.page} with fraud highlights`}
                      className="w-full h-full object-contain"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Markers legend / details list */}
          {allMarkers.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                Detected on the page
              </div>
              <ul className="space-y-2">
                {allMarkers.map((m) => {
                  const style = SEVERITY_STYLES[m.severity];
                  return (
                    <li
                      key={m.signal_id}
                      className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-white"
                    >
                      <span
                        className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold text-white flex-shrink-0 ${style.dot}`}
                      >
                        {m.marker}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-slate-800">
                            {humanizeSignalType(m.signal_type)}
                          </span>
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${style.pill}`}>
                            {style.label}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            page {m.page}
                          </span>
                        </div>
                        {m.evidence_text && (
                          <div className="text-xs text-slate-500 mt-0.5 line-clamp-2 font-mono">
                            “{m.evidence_text}”
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Text-stream signals — prompt injection + invisible unicode have no bbox */}
          {data.text_only_signals.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                Text-stream issues
              </div>
              <ul className="space-y-2">
                {data.text_only_signals.map((s) => {
                  const style = SEVERITY_STYLES[s.severity] || SEVERITY_STYLES.medium;
                  const ev = s.evidence as Record<string, unknown>;
                  const matched = (ev.matched as string) || (ev.snippet as string) || "";
                  const chars = (ev.characters_found as Array<{ name: string; count: number; codepoint: string }>) || [];
                  return (
                    <li
                      key={s.id}
                      className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-white"
                    >
                      <span className={`inline-block w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${style.dot}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-slate-800">
                            {humanizeSignalType(s.signal_type)}
                          </span>
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${style.pill}`}>
                            {style.label}
                          </span>
                        </div>
                        {chars.length > 0 && (
                          <div className="text-xs text-slate-500 mt-1">
                            {chars.map((c) => (
                              <span key={c.codepoint} className="inline-block mr-2 font-mono">
                                {c.codepoint} ({c.name}) × {c.count}
                              </span>
                            ))}
                          </div>
                        )}
                        {matched && (
                          <div className="text-xs text-slate-500 mt-0.5 font-mono line-clamp-2">
                            “{matched}”
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
