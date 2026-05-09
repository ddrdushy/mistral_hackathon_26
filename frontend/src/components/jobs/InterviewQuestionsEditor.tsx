"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PlusIcon,
  SparklesIcon,
  TrashIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";

interface InterviewQuestion {
  id: number;
  question_text: string;
  question_type: string;
  order_index: number;
  is_required: boolean;
  weight: number;
  expected_keywords: string[];
  expected_answer_summary: string;
  created_at: string | null;
  updated_at: string | null;
}

interface SuggestedQuestion {
  question_text: string;
  question_type: string;
  weight: number;
  expected_keywords: string[];
  expected_answer_summary: string;
}

const TYPE_OPTIONS = [
  { id: "behavioural", label: "Behavioural" },
  { id: "technical", label: "Technical" },
  { id: "situational", label: "Situational" },
  { id: "culture_fit", label: "Culture fit" },
  { id: "custom", label: "Custom" },
] as const;

const TYPE_BADGE: Record<string, string> = {
  behavioural: "bg-blue-50 text-blue-700",
  technical: "bg-emerald-50 text-emerald-700",
  situational: "bg-amber-50 text-amber-700",
  culture_fit: "bg-purple-50 text-purple-700",
  custom: "bg-slate-100 text-slate-700",
};

const MAX_QUESTIONS = 20;

export default function InterviewQuestionsEditor({ jobId }: { jobId: string }) {
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    question_text: "",
    question_type: "behavioural",
    is_required: false,
    weight: 3,
  });
  const [error, setError] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestCount, setSuggestCount] = useState(5);
  const [suggestTypes, setSuggestTypes] = useState<string[]>([
    "behavioural",
    "technical",
    "situational",
  ]);
  const [suggestions, setSuggestions] = useState<SuggestedQuestion[] | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiGet<{ questions: InterviewQuestion[] }>(
        `/jobs/${jobId}/interview-questions`,
      );
      setQuestions(res.questions ?? []);
    } catch (e) {
      setQuestions([]);
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!draft.question_text.trim()) return;
    if (questions.length >= MAX_QUESTIONS) {
      setError(`Maximum ${MAX_QUESTIONS} questions per job`);
      return;
    }
    try {
      setCreating(true);
      setError(null);
      await apiPost(`/jobs/${jobId}/interview-questions`, {
        question_text: draft.question_text.trim(),
        question_type: draft.question_type,
        is_required: draft.is_required,
        weight: draft.weight,
        expected_keywords: [],
      });
      setDraft({
        question_text: "",
        question_type: "behavioural",
        is_required: false,
        weight: 3,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const update = async (q: InterviewQuestion, patch: Partial<InterviewQuestion>) => {
    try {
      await apiPut(`/jobs/${jobId}/interview-questions/${q.id}`, patch);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  const remove = async (qid: number) => {
    if (!confirm("Delete this question?")) return;
    try {
      await apiDelete(`/jobs/${jobId}/interview-questions/${qid}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const reorder = async (qid: number, direction: -1 | 1) => {
    const ids = questions.map((q) => q.id);
    const idx = ids.indexOf(qid);
    if (idx < 0) return;
    const target = idx + direction;
    if (target < 0 || target >= ids.length) return;
    const swapped = [...ids];
    [swapped[idx], swapped[target]] = [swapped[target], swapped[idx]];
    try {
      await apiPost(`/jobs/${jobId}/interview-questions/reorder`, {
        question_ids: swapped,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reorder failed");
    }
  };

  const fetchSuggestions = async () => {
    try {
      setSuggestLoading(true);
      setSuggestError(null);
      const res = await apiPost<{ suggestions: SuggestedQuestion[] }>(
        `/jobs/${jobId}/interview-questions/suggest`,
        { count: suggestCount, types: suggestTypes },
      );
      setSuggestions(res.suggestions ?? []);
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : "Suggest failed");
      setSuggestions([]);
    } finally {
      setSuggestLoading(false);
    }
  };

  const acceptSuggestion = async (s: SuggestedQuestion) => {
    if (questions.length >= MAX_QUESTIONS) {
      setSuggestError(`Maximum ${MAX_QUESTIONS} questions per job`);
      return;
    }
    try {
      await apiPost(`/jobs/${jobId}/interview-questions`, {
        question_text: s.question_text,
        question_type: s.question_type,
        is_required: false,
        weight: s.weight,
        expected_keywords: s.expected_keywords,
        expected_answer_summary: s.expected_answer_summary,
      });
      await load();
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : "Failed to add");
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Interview Questions
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Used by the Q&A round and surfaced to the voice interview agent
            via dynamic variables. Required ones always get asked. Up to{" "}
            {MAX_QUESTIONS} per job.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setSuggestOpen(true);
            setSuggestions(null);
            setSuggestError(null);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md whitespace-nowrap"
        >
          <SparklesIcon className="h-4 w-4" />
          AI suggest
        </button>
      </div>

      {/* Existing questions */}
      {loading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 bg-slate-100 rounded animate-pulse" />
          ))}
        </div>
      ) : questions.length === 0 ? (
        <p className="text-sm text-slate-500 mb-4">
          No custom questions yet. Add one below or use AI suggest to seed a few.
        </p>
      ) : (
        <ul className="space-y-2 mb-4">
          {questions.map((q, idx) => (
            <li
              key={q.id}
              className="border border-slate-200 rounded-md px-3 py-2.5 flex gap-3 items-start"
            >
              <div className="flex flex-col gap-0.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => reorder(q.id, -1)}
                  disabled={idx === 0}
                  className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                  aria-label="Move up"
                >
                  <ChevronUpIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => reorder(q.id, 1)}
                  disabled={idx === questions.length - 1}
                  className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                  aria-label="Move down"
                >
                  <ChevronDownIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <textarea
                  value={q.question_text}
                  onChange={(e) =>
                    setQuestions((cur) =>
                      cur.map((x) =>
                        x.id === q.id ? { ...x, question_text: e.target.value } : x,
                      ),
                    )
                  }
                  onBlur={(e) => {
                    if (e.target.value !== q.question_text) {
                      update(q, { question_text: e.target.value });
                    }
                  }}
                  rows={2}
                  className="w-full text-sm text-slate-800 bg-transparent border-0 focus:outline-none focus:ring-0 resize-none p-0"
                />
                <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                  <select
                    value={q.question_type}
                    onChange={(e) => update(q, { question_type: e.target.value })}
                    className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold border-0 ${
                      TYPE_BADGE[q.question_type] || TYPE_BADGE.custom
                    }`}
                  >
                    {TYPE_OPTIONS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 cursor-pointer">
                    Weight:
                    <select
                      value={q.weight}
                      onChange={(e) =>
                        update(q, { weight: Number(e.target.value) })
                      }
                      className="border border-slate-200 rounded px-1 py-0.5"
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={q.is_required}
                      onChange={(e) =>
                        update(q, { is_required: e.target.checked })
                      }
                      className="rounded border-slate-300"
                    />
                    Required
                  </label>
                  {q.expected_keywords.length > 0 && (
                    <span className="text-slate-500">
                      Keywords: {q.expected_keywords.slice(0, 4).join(", ")}
                      {q.expected_keywords.length > 4 && "..."}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(q.id)}
                className="text-rose-500 hover:text-rose-700 flex-shrink-0"
                aria-label="Delete"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add new */}
      <div className="border-t border-slate-100 pt-4">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
          Add a question
        </p>
        <textarea
          value={draft.question_text}
          onChange={(e) => setDraft((d) => ({ ...d, question_text: e.target.value }))}
          rows={2}
          placeholder="e.g. Walk me through the trickiest production incident you've debugged."
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y"
          maxLength={1000}
        />
        <div className="mt-2 flex items-center gap-3 flex-wrap">
          <select
            value={draft.question_type}
            onChange={(e) => setDraft((d) => ({ ...d, question_type: e.target.value }))}
            className="text-xs px-2 py-1 border border-slate-300 rounded"
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-600">
            Weight:
            <select
              value={draft.weight}
              onChange={(e) => setDraft((d) => ({ ...d, weight: Number(e.target.value) }))}
              className="border border-slate-300 rounded px-1 py-0.5 text-xs"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={draft.is_required}
              onChange={(e) =>
                setDraft((d) => ({ ...d, is_required: e.target.checked }))
              }
              className="rounded border-slate-300"
            />
            Required
          </label>
          <button
            type="button"
            onClick={create}
            disabled={creating || !draft.question_text.trim() || questions.length >= MAX_QUESTIONS}
            className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            {creating ? "Adding..." : "Add"}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {/* AI suggest modal */}
      {suggestOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50"
          onClick={() => setSuggestOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <SparklesIcon className="h-5 w-5 text-indigo-600" />
                  AI-suggested questions
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Mistral generates questions tailored to this job. Review,
                  then add the ones you like.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSuggestOpen(false)}
                className="text-slate-500 hover:text-slate-800"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-4 overflow-y-auto flex-1">
              {!suggestions ? (
                <>
                  <div className="flex items-center gap-3 mb-3">
                    <label className="text-xs font-medium text-slate-600">
                      Count:
                      <select
                        value={suggestCount}
                        onChange={(e) => setSuggestCount(Number(e.target.value))}
                        className="ml-2 border border-slate-300 rounded px-2 py-1 text-sm"
                      >
                        {[3, 5, 8, 10, 12].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex items-center gap-2 flex-wrap">
                      {TYPE_OPTIONS.filter((t) => t.id !== "custom").map((t) => (
                        <label
                          key={t.id}
                          className="flex items-center gap-1 text-xs text-slate-600"
                        >
                          <input
                            type="checkbox"
                            checked={suggestTypes.includes(t.id)}
                            onChange={(e) =>
                              setSuggestTypes((cur) =>
                                e.target.checked
                                  ? [...cur, t.id]
                                  : cur.filter((x) => x !== t.id),
                              )
                            }
                            className="rounded border-slate-300"
                          />
                          {t.label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={fetchSuggestions}
                    disabled={suggestLoading}
                    className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50"
                  >
                    {suggestLoading ? "Generating..." : "Generate"}
                  </button>
                </>
              ) : suggestions.length === 0 ? (
                <p className="text-sm text-slate-500">No suggestions returned.</p>
              ) : (
                <ul className="space-y-2">
                  {suggestions.map((s, i) => (
                    <li
                      key={i}
                      className="border border-slate-200 rounded-md px-3 py-2.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-800">
                            {s.question_text}
                          </p>
                          <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-slate-500">
                            <span
                              className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold ${
                                TYPE_BADGE[s.question_type] || TYPE_BADGE.custom
                              }`}
                            >
                              {s.question_type}
                            </span>
                            <span>weight {s.weight}</span>
                            {s.expected_keywords.length > 0 && (
                              <span className="truncate">
                                keywords: {s.expected_keywords.join(", ")}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => acceptSuggestion(s)}
                          className="px-2 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded flex-shrink-0"
                        >
                          + Add
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {suggestError && (
                <p className="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                  {suggestError}
                </p>
              )}
            </div>

            <div className="px-6 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
              {suggestions && (
                <button
                  type="button"
                  onClick={() => {
                    setSuggestions(null);
                    setSuggestError(null);
                  }}
                  className="px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-md"
                >
                  Generate again
                </button>
              )}
              <button
                type="button"
                onClick={() => setSuggestOpen(false)}
                className="px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-md"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
