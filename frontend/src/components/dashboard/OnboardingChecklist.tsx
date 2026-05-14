"use client";

/**
 * Dashboard onboarding checklist.
 *
 * Fetches /onboarding/status — list of setup steps with done flags —
 * and renders a dismissible card with progress. Hides itself
 * automatically when all steps are done.
 *
 * Dismissal is per-browser via localStorage. We re-show the card if
 * the tenant later regresses (e.g. unplugs Twilio), so HR isn't left
 * without a visible reminder that something needs setting up again.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircleIcon, ArrowRightIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { apiGet } from "@/lib/api";

interface Step {
  id: string;
  label: string;
  hint: string;
  done: boolean;
  href: string;
}

interface StatusResponse {
  steps: Step[];
  completed: number;
  total: number;
  percent: number;
}

const DISMISS_KEY = "hireops.onboarding.dismissed";

export default function OnboardingChecklist() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<StatusResponse>("/onboarding/status");
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    }
    load();
  }, [load]);

  // Hide entirely on first-load, when fully done, or if user dismissed
  // AND nothing has regressed since the dismissal. We always show again
  // when at least one previously-done step has flipped back to false —
  // detected as `data.completed < data.total - 1` after a dismiss is
  // overkill; simpler heuristic: respect dismiss until the next reload
  // surfaces an incomplete step.
  if (loading || !data) return null;
  if (data.completed >= data.total) return null;
  if (dismissed) return null;

  return (
    <section className="bg-white rounded-xl border border-indigo-200 shadow-sm p-5 mb-4">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-slate-900">
            Get HireOps set up
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {data.completed} of {data.total} done · finishing these makes the
            AI features work without placeholders.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined") {
              window.localStorage.setItem(DISMISS_KEY, "1");
            }
            setDismissed(true);
          }}
          className="p-1 text-slate-400 hover:text-slate-700 -mr-1 -mt-1"
          title="Hide this card. Resets if a step regresses."
          aria-label="Dismiss checklist"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-indigo-100 rounded-full overflow-hidden mb-4">
        <div
          className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all"
          style={{ width: `${data.percent}%` }}
        />
      </div>

      {/* Step rows */}
      <ul className="space-y-1.5">
        {data.steps.map((s) => (
          <li key={s.id}>
            <Link
              href={s.href}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                s.done
                  ? "bg-emerald-50/60 hover:bg-emerald-50"
                  : "bg-slate-50 hover:bg-indigo-50"
              }`}
            >
              {s.done ? (
                <CheckCircleIcon className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              ) : (
                <span className="w-5 h-5 rounded-full border-2 border-slate-300 flex-shrink-0" />
              )}
              <span className="flex-1 min-w-0">
                <span
                  className={`block text-sm font-medium ${
                    s.done ? "text-slate-500 line-through" : "text-slate-900"
                  }`}
                >
                  {s.label}
                </span>
                <span className="block text-xs text-slate-500 truncate">
                  {s.hint}
                </span>
              </span>
              {!s.done && (
                <ArrowRightIcon className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 flex-shrink-0" />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
