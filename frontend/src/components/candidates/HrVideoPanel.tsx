"use client";

import { useState } from "react";
import { apiPost } from "@/lib/api";
import {
  VideoCameraIcon,
  ArrowTopRightOnSquareIcon,
} from "@heroicons/react/24/outline";

/**
 * Recruiter side of the hr_video interview flow.
 *
 * Two actions:
 *   1. "Join interview room" — opens the same Jitsi room the candidate
 *      lands in (room name derived from the interview token). New tab
 *      so the recruiter can keep the candidate detail page open
 *      alongside for note-taking.
 *   2. "Submit interview score" — small form HR fills in after the
 *      call. Posts to /screening/{id}/hr-score which populates
 *      interview_score / interview_score_json with the same shape the
 *      LLM evaluator produces, so the rest of the UI renders the same.
 */

function roomUrlFromToken(token: string): string {
  const room = `hireops-interview-${token.slice(0, 16)}`;
  const params =
    `#config.prejoinPageEnabled=false` +
    `&config.startWithAudioMuted=false` +
    `&config.startWithVideoMuted=false`;
  return `https://meet.jit.si/${room}${params}`;
}

interface Props {
  applicationId: number;
  interviewToken: string | null;
  hasExistingScore: boolean;
  onScored: () => void;
}

export default function HrVideoPanel({
  applicationId,
  interviewToken,
  hasExistingScore,
  onScored,
}: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const [score, setScore] = useState(70);
  const [decision, setDecision] = useState<"advance" | "hold" | "reject">("advance");
  const [strengths, setStrengths] = useState("");
  const [concerns, setConcerns] = useState("");
  const [notes, setNotes] = useState("");
  const [comm, setComm] = useState("good");
  const [tech, setTech] = useState("good");
  const [culture, setCulture] = useState("good");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/screening/${applicationId}/hr-score`, {
        score,
        decision,
        strengths: strengths
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        concerns: concerns
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        notes,
        communication_rating: comm,
        technical_depth: tech,
        cultural_fit: culture,
      });
      setFormOpen(false);
      onScored();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-5 space-y-4">
      <div className="flex items-start gap-3">
        <VideoCameraIcon className="w-6 h-6 text-indigo-700 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-indigo-900">HR Video Interview</h3>
          <p className="text-xs text-indigo-800 mt-0.5">
            This job is configured for a recruiter-led video interview. Join the
            in-platform room when the candidate is ready, then record your
            verdict below.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {interviewToken ? (
          <a
            href={roomUrlFromToken(interviewToken)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold"
          >
            <VideoCameraIcon className="w-4 h-4" />
            Join interview room
            <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
          </a>
        ) : (
          <span className="text-xs text-slate-500">
            Generate an interview link first to enable the meeting room.
          </span>
        )}
        {!formOpen && (
          <button
            onClick={() => setFormOpen(true)}
            disabled={!interviewToken}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-50 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {hasExistingScore ? "Update interview score" : "Submit interview score"}
          </button>
        )}
      </div>

      {formOpen && (
        <form onSubmit={submit} className="space-y-3 bg-white rounded-lg border border-indigo-100 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold text-slate-700">
                Overall score (0–100)
              </span>
              <input
                type="number"
                min={0}
                max={100}
                value={score}
                onChange={(e) => setScore(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-700">Decision</span>
              <select
                value={decision}
                onChange={(e) => setDecision(e.target.value as typeof decision)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                <option value="advance">Advance</option>
                <option value="hold">Hold</option>
                <option value="reject">Reject</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-semibold text-slate-700">Communication</span>
              <select
                value={comm}
                onChange={(e) => setComm(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                {["excellent", "good", "fair", "poor"].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-700">Technical depth</span>
              <select
                value={tech}
                onChange={(e) => setTech(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                {["strong", "good", "fair", "weak"].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-700">Cultural fit</span>
              <select
                value={culture}
                onChange={(e) => setCulture(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                {["strong", "good", "fair", "weak"].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-semibold text-slate-700">
              Strengths (one per line)
            </span>
            <textarea
              value={strengths}
              onChange={(e) => setStrengths(e.target.value)}
              rows={3}
              placeholder="e.g. Strong on system design&#10;Asked thoughtful clarifying questions"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-slate-700">
              Concerns (one per line)
            </span>
            <textarea
              value={concerns}
              onChange={(e) => setConcerns(e.target.value)}
              rows={3}
              placeholder="e.g. Limited Kubernetes experience&#10;Salary expectation above range"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-slate-700">
              Notes / summary
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={4000}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>

          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold disabled:opacity-50"
            >
              {busy ? "Submitting…" : "Submit score"}
            </button>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="inline-flex items-center px-3 py-2 rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
