"use client";

import { useEffect, useState } from "react";
import type {
  QaSessionStartResponse,
  QaRoundSubmitResponse,
  QaRound,
} from "@/types/index";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "https://dushy2009-hireops-ai.hf.space/api/v1";

const ROUND_LABELS: Record<QaRound, string> = {
  aptitude: "Aptitude",
  reasoning: "Reasoning",
  technical: "Technical",
};

const ROUND_DESCRIPTIONS: Record<QaRound, string> = {
  aptitude:
    "Quick numerical, pattern, and basic logic questions. Aim for clear, concise answers.",
  reasoning:
    "Situational and analytical scenarios. Take your time — explain your thinking.",
  technical:
    "Questions tailored to your CV and the role. Be specific and concrete.",
};

type Phase =
  | { type: "loading" }
  | { type: "intro"; data: QaSessionStartResponse }
  | { type: "round"; data: QaSessionStartResponse }
  | { type: "submitting" }
  | { type: "round_done"; result: QaRoundSubmitResponse; nextRound: QaRound; nextQuestions: string[]; meta: { jobTitle: string; companyName: string; firstName: string; totalRounds: number } }
  | { type: "completed"; result: QaRoundSubmitResponse }
  | { type: "error"; message: string };

export default function QaInterviewRoom({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>({ type: "loading" });
  const [answers, setAnswers] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const res = await fetch(`${API_BASE}/screening/qa/${token}/start`, {
          method: "POST",
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `Failed to start (status ${res.status})`);
        }
        const data: QaSessionStartResponse = await res.json();
        if (cancelled) return;
        setAnswers(new Array(data.questions.length).fill(""));
        setPhase({ type: "intro", data });
      } catch (e) {
        if (cancelled) return;
        setPhase({
          type: "error",
          message: e instanceof Error ? e.message : "Failed to start Q&A interview",
        });
      }
    }
    start();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submitRound = async (round: QaRound, currentAnswers: string[], data: QaSessionStartResponse) => {
    setPhase({ type: "submitting" });
    try {
      const res = await fetch(`${API_BASE}/screening/qa/${token}/submit-round`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ round, answers: currentAnswers }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Submit failed (status ${res.status})`);
      }
      const result: QaRoundSubmitResponse = await res.json();
      if (result.completed) {
        setPhase({ type: "completed", result });
      } else if (result.next_round) {
        setPhase({
          type: "round_done",
          result,
          nextRound: result.next_round,
          nextQuestions: result.next_questions,
          meta: {
            jobTitle: data.job_title,
            companyName: data.company_name,
            firstName: data.candidate_first_name,
            totalRounds: data.total_rounds,
          },
        });
      }
    } catch (e) {
      setPhase({
        type: "error",
        message: e instanceof Error ? e.message : "Failed to submit round",
      });
    }
  };

  const advanceToNextRound = () => {
    if (phase.type !== "round_done") return;
    const newData: QaSessionStartResponse = {
      token,
      candidate_first_name: phase.meta.firstName,
      job_title: phase.meta.jobTitle,
      company_name: phase.meta.companyName,
      current_round: phase.nextRound,
      round_index:
        phase.nextRound === "reasoning"
          ? 2
          : phase.nextRound === "technical"
            ? 3
            : 1,
      total_rounds: phase.meta.totalRounds,
      questions: phase.nextQuestions,
    };
    setAnswers(new Array(phase.nextQuestions.length).fill(""));
    setPhase({ type: "round", data: newData });
  };

  // ── Render states ──

  if (phase.type === "loading") {
    return (
      <Centered>
        <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-slate-500">Generating your interview questions...</p>
        <p className="text-xs text-slate-400 mt-2">This takes 5-10 seconds.</p>
      </Centered>
    );
  }

  if (phase.type === "error") {
    return (
      <Centered>
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl">!</span>
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">
          Could not start interview
        </h1>
        <p className="text-sm text-slate-500">{phase.message}</p>
      </Centered>
    );
  }

  if (phase.type === "intro") {
    const d = phase.data;
    return (
      <Centered wide>
        <div className="text-left">
          <p className="text-xs uppercase tracking-wide text-indigo-600 font-semibold mb-2">
            Written Q&A Interview
          </p>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            Welcome{d.candidate_first_name ? `, ${d.candidate_first_name}` : ""}
          </h1>
          <p className="text-sm text-slate-600 mb-6">
            You&apos;re interviewing for <strong>{d.job_title}</strong> at {d.company_name}.
          </p>

          <div className="space-y-3 mb-6">
            <RoundChip index={1} label="Aptitude" desc="Quick numerical & logic" active />
            <RoundChip index={2} label="Reasoning" desc="Situational scenarios" />
            <RoundChip index={3} label="Technical" desc="Tailored to your CV" />
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 mb-6 text-sm text-slate-600 leading-relaxed">
            <p className="font-medium text-slate-800 mb-1">How it works</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>3 rounds, 3 questions each. Untimed.</li>
              <li>You&apos;ll see your score and feedback after each round.</li>
              <li>Answer in your own words — quality over length.</li>
              <li>Once submitted, a round can&apos;t be redone.</li>
            </ul>
          </div>

          <button
            type="button"
            onClick={() => setPhase({ type: "round", data: d })}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
          >
            Start Round 1: Aptitude
          </button>
        </div>
      </Centered>
    );
  }

  if (phase.type === "round") {
    const d = phase.data;
    const round = d.current_round;
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-3xl mx-auto px-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-xs uppercase tracking-wide text-indigo-600 font-semibold">
                Round {d.round_index} of {d.total_rounds}
              </p>
              <h1 className="text-2xl font-bold text-slate-900">
                {ROUND_LABELS[round]}
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                {ROUND_DESCRIPTIONS[round]}
              </p>
            </div>
            <ProgressIndicator
              currentIndex={d.round_index}
              total={d.total_rounds}
            />
          </div>

          {/* Questions */}
          <div className="space-y-4">
            {d.questions.map((q, i) => (
              <div
                key={i}
                className="bg-white rounded-xl border border-slate-200 shadow-sm p-5"
              >
                <p className="text-sm font-medium text-slate-900 mb-3">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold mr-2">
                    {i + 1}
                  </span>
                  {q}
                </p>
                <textarea
                  value={answers[i] ?? ""}
                  onChange={(e) => {
                    const next = [...answers];
                    next[i] = e.target.value;
                    setAnswers(next);
                  }}
                  rows={4}
                  placeholder="Type your answer here..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-y"
                />
                <p className="mt-1 text-xs text-slate-400">
                  {answers[i]?.trim().length ?? 0} characters
                </p>
              </div>
            ))}
          </div>

          {/* Submit */}
          <div className="mt-6 flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Answered {answers.filter((a) => a.trim().length > 0).length}/{d.questions.length}
            </p>
            <button
              type="button"
              onClick={() => submitRound(round, answers, d)}
              disabled={answers.every((a) => !a.trim())}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {d.round_index === d.total_rounds
                ? "Submit Final Round"
                : `Submit & Continue to ${ROUND_LABELS[
                    d.round_index === 1 ? "reasoning" : "technical"
                  ]}`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase.type === "submitting") {
    return (
      <Centered>
        <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-slate-500">Scoring your answers...</p>
        <p className="text-xs text-slate-400 mt-2">This takes a few seconds.</p>
      </Centered>
    );
  }

  if (phase.type === "round_done") {
    const r = phase.result;
    return (
      <Centered wide>
        <div className="text-left">
          <p className="text-xs uppercase tracking-wide text-emerald-600 font-semibold mb-2">
            Round complete
          </p>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            {ROUND_LABELS[r.round]}: {Math.round(r.round_score)}/100
          </h1>
          <p className="text-sm text-slate-600 mb-5 leading-relaxed">
            {r.feedback}
          </p>
          <div className="rounded-lg bg-indigo-50 border border-indigo-200 p-4 mb-6 text-sm text-indigo-900">
            Next up: <strong>{ROUND_LABELS[phase.nextRound]}</strong> — {ROUND_DESCRIPTIONS[phase.nextRound]}
          </div>
          <button
            type="button"
            onClick={advanceToNextRound}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
          >
            Continue to {ROUND_LABELS[phase.nextRound]}
          </button>
        </div>
      </Centered>
    );
  }

  if (phase.type === "completed") {
    const r = phase.result;
    return (
      <Centered wide>
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-8 h-8 text-emerald-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.5 12.75l6 6 9-13.5"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2 text-center">
          Interview submitted
        </h1>
        <p className="text-sm text-slate-500 mb-6 text-center">
          Thanks for completing the Q&A. Our team will review your responses and follow up shortly.
        </p>
        {r.final_score !== null && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-center">
            <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">
              Overall score
            </p>
            <p className="text-3xl font-bold text-slate-900">
              {Math.round(r.final_score)}/100
            </p>
          </div>
        )}
      </Centered>
    );
  }

  return null;
}

// ── Helpers ──

function Centered({
  children,
  wide,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className={`${wide ? "max-w-xl" : "max-w-md"} w-full mx-4`}>
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-8">
          {children}
        </div>
      </div>
    </div>
  );
}

function RoundChip({
  index,
  label,
  desc,
  active,
}: {
  index: number;
  label: string;
  desc: string;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg border ${
        active ? "bg-indigo-50 border-indigo-200" : "bg-slate-50 border-slate-200"
      }`}
    >
      <span
        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
          active ? "bg-indigo-600 text-white" : "bg-slate-300 text-white"
        }`}
      >
        {index}
      </span>
      <div>
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        <p className="text-xs text-slate-500">{desc}</p>
      </div>
    </div>
  );
}

function ProgressIndicator({
  currentIndex,
  total,
}: {
  currentIndex: number;
  total: number;
}) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`w-8 h-1.5 rounded-full ${
            i < currentIndex ? "bg-indigo-600" : "bg-slate-200"
          }`}
        />
      ))}
    </div>
  );
}
