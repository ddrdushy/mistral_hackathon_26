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
    description: "",
  });

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

  const handleGenerate = async () => {
    if (!form.title.trim()) {
      setTitleError(true);
      return;
    }

    setGenerating(true);
    setError(null);
    try {
      const result = await apiPost<JobCreate>("/jobs/generate", { title: form.title.trim() });
      setForm({
        title: form.title.trim(),
        department: result.department || "",
        location: result.location || "",
        seniority: result.seniority || "mid",
        skills: result.skills || [],
        description: result.description || "",
      });
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
      await apiPost<Job>("/jobs", form);
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
                    AI Auto-Fill
                  </>
                )}
              </button>
            </div>
            {titleError && (
              <p className="mt-1 text-xs text-red-600">Title is required</p>
            )}
            <p className="mt-1.5 text-xs text-slate-400">
              Enter a title and click &quot;AI Auto-Fill&quot; to let Mistral generate all fields
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
