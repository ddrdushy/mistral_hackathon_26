"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api";
import { SENIORITY_OPTIONS } from "@/lib/constants";
import type { Job, JobCreate } from "@/types/index";

export default function CreateJobPage() {
  const router = useRouter();

  const [form, setForm] = useState<JobCreate>({
    title: "",
    department: "",
    location: "",
    seniority: "mid",
    skills: [],
    responsibilities: [],
    qualifications: [],
    description: "",
    interview_mode: "voice",
  });

  // Per-job interview question auto-generation. Defaults to a reasonable
  // mix; HR can dial each type up/down or zero it out. Sent to the
  // backend on submit; the suggest_questions agent fires post-create and
  // any failure is non-blocking.
  const [autoGenerateQuestions, setAutoGenerateQuestions] = useState(true);
  const [questionCounts, setQuestionCounts] = useState<Record<string, number>>({
    behavioural: 3,
    technical: 3,
    situational: 2,
    culture_fit: 0,
  });

  const adjustCount = (type: string, delta: number) => {
    setQuestionCounts((prev) => ({
      ...prev,
      [type]: Math.max(0, Math.min(8, (prev[type] ?? 0) + delta)),
    }));
  };
  const totalQuestions = Object.values(questionCounts).reduce((a, b) => a + b, 0);

  const [skillInput, setSkillInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState(false);
  const [aiGenerated, setAiGenerated] = useState(false);

  const handleChange = (field: keyof JobCreate, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (field === "title" && value.trim()) {
      setTitleError(false);
    }
  };

  const addSkills = () => {
    const newSkills = skillInput
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !form.skills.includes(s));
    if (newSkills.length > 0) {
      setForm((prev) => ({ ...prev, skills: [...prev.skills, ...newSkills] }));
    }
    setSkillInput("");
  };

  const handleSkillKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addSkills();
    }
  };

  const removeSkill = (skill: string) => {
    setForm((prev) => ({
      ...prev,
      skills: prev.skills.filter((s) => s !== skill),
    }));
  };

  const removeResponsibility = (index: number) => {
    setForm((prev) => ({
      ...prev,
      responsibilities: prev.responsibilities.filter((_, i) => i !== index),
    }));
  };

  const removeQualification = (index: number) => {
    setForm((prev) => ({
      ...prev,
      qualifications: prev.qualifications.filter((_, i) => i !== index),
    }));
  };

  const handleGenerate = async () => {
    if (!form.title.trim()) {
      setTitleError(true);
      return;
    }

    setGenerating(true);
    setError(null);
    try {
      const result = await apiPost<JobCreate>("/jobs/generate", { title: form.title.trim() });
      setForm((prev) => ({
        title: form.title.trim(),
        department: result.department || "",
        location: result.location || "",
        seniority: result.seniority || "mid",
        skills: result.skills || [],
        responsibilities: result.responsibilities || [],
        qualifications: result.qualifications || [],
        description: result.description || "",
        interview_mode: prev.interview_mode,
      }));
      setAiGenerated(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "AI generation failed";
      setError(message);
    } finally {
      setGenerating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.title.trim()) {
      setTitleError(true);
      return;
    }

    setSubmitting(true);
    try {
      const payload: JobCreate = { ...form };
      if (autoGenerateQuestions && totalQuestions > 0) {
        // Strip zero-count types so the backend doesn't fire empty prompts.
        payload.interview_question_counts = Object.fromEntries(
          Object.entries(questionCounts).filter(([, n]) => n > 0),
        );
      }
      await apiPost<Job>("/jobs", payload);
      router.push("/jobs");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create job";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold text-slate-900 mb-6">Create Job</h1>

      <form onSubmit={handleSubmit}>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5">
          {/* Error banner */}
          {error && (
            <div className="px-4 py-3 rounded-lg bg-red-50 text-red-800 border border-red-200 text-sm">
              {error}
            </div>
          )}

          {/* AI Generated Success banner */}
          {aiGenerated && (
            <div className="px-4 py-3 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-sm flex items-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              AI auto-filled all fields from your title. Review and adjust before creating.
            </div>
          )}

          {/* Title + AI Generate Button */}
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-slate-700 mb-1">
              Job Title <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <input
                id="title"
                type="text"
                value={form.title}
                onChange={(e) => handleChange("title", e.target.value)}
                placeholder="e.g. Senior Frontend Engineer"
                className={`flex-1 px-3 py-2 rounded-lg border text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors ${
                  titleError ? "border-red-300 bg-red-50" : "border-slate-300"
                }`}
              />
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating || !form.title.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
              >
                {generating ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Generating...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    Draft with AI
                  </>
                )}
              </button>
            </div>
            {titleError && (
              <p className="mt-1 text-xs text-red-600">Title is required</p>
            )}
            <p className="mt-1.5 text-xs text-slate-400">
              Type a title and click <span className="font-medium">Draft with AI</span> — Mistral fills department, skills, responsibilities, qualifications, and a full description in seconds.
            </p>
          </div>

          {/* Department */}
          <div>
            <label htmlFor="department" className="block text-sm font-medium text-slate-700 mb-1">
              Department
            </label>
            <input
              id="department"
              type="text"
              value={form.department}
              onChange={(e) => handleChange("department", e.target.value)}
              placeholder="e.g. Engineering"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* Location */}
          <div>
            <label htmlFor="location" className="block text-sm font-medium text-slate-700 mb-1">
              Location
            </label>
            <input
              id="location"
              type="text"
              value={form.location}
              onChange={(e) => handleChange("location", e.target.value)}
              placeholder="e.g. San Francisco, CA / Remote"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* Seniority */}
          <div>
            <label htmlFor="seniority" className="block text-sm font-medium text-slate-700 mb-1">
              Seniority
            </label>
            <select
              id="seniority"
              value={form.seniority}
              onChange={(e) => handleChange("seniority", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
            >
              {SENIORITY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt.charAt(0).toUpperCase() + opt.slice(1)}
                </option>
              ))}
            </select>
          </div>

          {/* First-Round Interview Mode */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              First-Round Interview Mode
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(
                [
                  {
                    value: "voice" as const,
                    title: "Voice Interview",
                    desc: "Candidate joins a web room for an ElevenLabs AI voice interview with face tracking.",
                  },
                  {
                    value: "qa" as const,
                    title: "Written Q&A",
                    desc: "Candidate answers 3 LLM-generated rounds: aptitude, reasoning, and CV-based technical.",
                  },
                ]
              ).map((opt) => {
                const selected = form.interview_mode === opt.value;
                return (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() =>
                      setForm((prev) => ({ ...prev, interview_mode: opt.value }))
                    }
                    className={`text-left rounded-lg border p-3 transition-all ${
                      selected
                        ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                          selected ? "border-indigo-600" : "border-slate-300"
                        }`}
                      >
                        {selected && (
                          <span className="w-2 h-2 rounded-full bg-indigo-600" />
                        )}
                      </span>
                      <span className="text-sm font-semibold text-slate-900">
                        {opt.title}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 leading-snug">{opt.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Auto-generate interview questions */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoGenerateQuestions}
                onChange={(e) => setAutoGenerateQuestions(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>
                <span className="block text-sm font-semibold text-slate-900">
                  Auto-generate interview questions
                </span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  AI drafts a starter question bank right after the job is
                  created. You can edit, reorder, or delete any of them from
                  the job&apos;s detail page.
                </span>
              </span>
            </label>

            {autoGenerateQuestions && (
              <div className="mt-4 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                  How many of each type?
                </div>
                {(
                  [
                    { key: "behavioural", label: "Behavioural", hint: "Past experience, teamwork, conflict." },
                    { key: "technical",   label: "Technical",   hint: "Tools, languages, problem-solving." },
                    { key: "situational", label: "Situational", hint: "How would you handle…" },
                    { key: "culture_fit", label: "Culture fit", hint: "Values, work style, motivation." },
                  ] as const
                ).map(({ key, label, hint }) => (
                  <div key={key} className="flex items-center justify-between gap-3 py-1">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-800">{label}</div>
                      <div className="text-xs text-slate-500">{hint}</div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => adjustCount(key, -1)}
                        className="w-7 h-7 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100"
                        aria-label={`Decrease ${label}`}
                      >
                        –
                      </button>
                      <span className="w-7 text-center text-sm font-semibold tabular-nums">
                        {questionCounts[key] ?? 0}
                      </span>
                      <button
                        type="button"
                        onClick={() => adjustCount(key, +1)}
                        className="w-7 h-7 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100"
                        aria-label={`Increase ${label}`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
                <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
                  <span>Total</span>
                  <span className="font-semibold text-slate-700">
                    {totalQuestions} question{totalQuestions === 1 ? "" : "s"}
                    {totalQuestions > 20 ? " — will be capped at 20" : ""}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Skills */}
          <div>
            <label htmlFor="skills" className="block text-sm font-medium text-slate-700 mb-1">
              Skills
            </label>
            <div className="flex gap-2">
              <input
                id="skills"
                type="text"
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={handleSkillKeyDown}
                placeholder="Type skills separated by commas, press Enter"
                className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={addSkills}
                className="px-4 py-2 text-sm font-medium rounded-lg text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors"
              >
                Add
              </button>
            </div>
            {form.skills.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {form.skills.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700"
                  >
                    {skill}
                    <button
                      type="button"
                      onClick={() => removeSkill(skill)}
                      className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-indigo-200 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Responsibilities (AI-generated, editable) */}
          {form.responsibilities.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Responsibilities
              </label>
              <ul className="space-y-1.5">
                {form.responsibilities.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2 group">
                    <span className="text-indigo-400 mt-0.5 text-sm">•</span>
                    <span className="flex-1 text-sm text-slate-700">{item}</span>
                    <button
                      type="button"
                      onClick={() => removeResponsibility(idx)}
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-all"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Qualifications (AI-generated, editable) */}
          {form.qualifications.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Qualifications
              </label>
              <ul className="space-y-1.5">
                {form.qualifications.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2 group">
                    <span className="text-emerald-400 mt-0.5 text-sm">✓</span>
                    <span className="flex-1 text-sm text-slate-700">{item}</span>
                    <button
                      type="button"
                      onClick={() => removeQualification(idx)}
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-all"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Description */}
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-slate-700 mb-1">
              Description
            </label>
            <textarea
              id="description"
              value={form.description}
              onChange={(e) => handleChange("description", e.target.value)}
              placeholder="Describe the role, responsibilities, and requirements..."
              rows={8}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-vertical"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={() => router.push("/jobs")}
              className="px-4 py-2 text-sm font-medium rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Creating...
                </>
              ) : (
                "Create Job"
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
