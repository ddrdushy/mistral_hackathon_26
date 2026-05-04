"use client";

import React from "react";

const PIPELINE = [
  { stage: "new", label: "New" },
  { stage: "classified", label: "Classified" },
  { stage: "matched", label: "Matched" },
  { stage: "screening_scheduled", label: "Screening" },
  { stage: "screened", label: "Screened" },
  { stage: "shortlisted", label: "Shortlisted" },
] as const;

const REJECTED = "rejected";

/**
 * Horizontal pipeline stepper. Shows the candidate's current stage in the
 * hiring funnel at a glance. Rejected candidates render with a single red pill.
 */
export default function PipelineStepper({ stage }: { stage: string }) {
  if (stage === REJECTED) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-50 border border-red-200">
        <span className="w-2 h-2 rounded-full bg-red-500" />
        <span className="text-xs font-semibold text-red-700">Rejected</span>
      </div>
    );
  }

  const currentIdx = PIPELINE.findIndex((s) => s.stage === stage);
  const activeIdx = currentIdx >= 0 ? currentIdx : 0;

  return (
    <div className="flex items-center w-full">
      {PIPELINE.map((s, i) => {
        const isDone = i < activeIdx;
        const isActive = i === activeIdx;
        const dot = isDone
          ? "bg-emerald-500 ring-emerald-500"
          : isActive
            ? "bg-indigo-600 ring-indigo-200"
            : "bg-white ring-slate-300";
        const dotInner = isDone || isActive ? "text-white" : "text-slate-400";
        const labelClass = isActive
          ? "text-indigo-700 font-semibold"
          : isDone
            ? "text-emerald-700"
            : "text-slate-400";
        const lineClass = i < activeIdx ? "bg-emerald-500" : "bg-slate-200";

        return (
          <React.Fragment key={s.stage}>
            <div className="flex flex-col items-center min-w-0">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center ring-2 ${dot}`}
              >
                {isDone ? (
                  <svg
                    className={`w-3.5 h-3.5 ${dotInner}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  <span className={`text-[10px] font-bold ${dotInner}`}>{i + 1}</span>
                )}
              </div>
              <span
                className={`mt-1.5 text-[10px] tracking-wide whitespace-nowrap ${labelClass}`}
              >
                {s.label}
              </span>
            </div>
            {i < PIPELINE.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 ${lineClass}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
