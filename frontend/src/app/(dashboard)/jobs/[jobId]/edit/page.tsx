"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { apiGet, apiPut } from "@/lib/api";
import { SENIORITY_OPTIONS } from "@/lib/constants";
import type { Job, JobCreate } from "@/types/index";

export default function EditJobPage() {
  const router = useRouter();
  const params = useParams();
  const jobId = params.jobId as string;

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
    expires_at: "",
    resume_threshold_min: 80,
    interview_threshold_min: 75,
    final_threshold_reject: 50,
  });
  const [originalJobId, setOriginalJobId] = useState<string>("");
  const [skillInput, setSkillInput] = useState("");
  const [respInput, setRespInput] = useState("");
  const [qualInput, setQualInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState(false);

  const fetchJob = useCallback(async () => {
    try {
      const data = await apiGet<Job>(`/jobs/${jobId}`);
      setForm({
        title: data.title || "",
        department: data.department || "",
        location: data.location || "",
        seniority: data.seniority || "mid",
        skills: data.skills || [],
        responsibilities: data.responsibilities || [],
        qualifications: data.qualifications || [],
        description: data.description || "",
        interview_mode: data.interview_mode || "voice",
        // backend returns full ISO timestamp; <input type="date"> only
        // accepts YYYY-MM-DD, so slice the date portion.
        expires_at: data.expires_at ? data.expires_at.slice(0, 10) : "",
        resume_threshold_min: data.resume_threshold_min ?? 80,
        interview_threshold_min: data.interview_threshold_min ?? 75,
        final_threshold_reject: data.final_threshold_reject ?? 50,
      });
      setOriginalJobId(data.job_id || "");
    } catch {
      setError("Failed to load job");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  const handleChange = (field: keyof JobCreate, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (field === "title" && value.trim()) setTitleError(false);
  };

  const addSkills = () => {
    const next = skillInput
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !form.skills.includes(s));
    if (next.length > 0) {
      setForm((prev) => ({ ...prev, skills: [...prev.skills, ...next] }));
    }
    setSkillInput("");
  };

  const handleSkillKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addSkills();
    }
  };

  const removeSkill = (skill: string) =>
    setForm((prev) => ({ ...prev, skills: prev.skills.filter((s) => s !== skill) }));

  const addBullet = (
    field: "responsibilities" | "qualifications",
    value: string,
    setInput: (s: string) => void,
  ) => {
    const v = value.trim();
    if (!v) return;
    setForm((prev) => ({ ...prev, [field]: [...prev[field], v] }));
    setInput("");
  };

  const removeBullet = (field: "responsibilities" | "qualifications", idx: number) =>
    setForm((prev) => ({
      ...prev,
      [field]: prev[field].filter((_, i) => i !== idx),
    }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.title.trim()) {
      setTitleError(true);
      return;
    }

    setSubmitting(true);
    try {
      // Coerce expires_at: empty string → null (clears the date).
      // Date-only input → ISO at UTC midnight so the backend stores a
      // timezone-aware end-of-day-ish moment without surprises.
      const payload = {
        ...form,
        expires_at: form.expires_at
          ? `${form.expires_at}T00:00:00.000Z`
          : null,
      };
      await apiPut<Job>(`/jobs/${jobId}`, payload);
      router.push(`/jobs/${jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-16">
        <svg className="animate-spin h-8 w-8 text-indigo-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-slate-500">Loading job…</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <button
          type="button"
          onClick={() => router.push(`/jobs/${jobId}`)}
          className="text-sm text-slate-500 hover:text-slate-900 inline-flex items-center gap-1 mb-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to {originalJobId || "job"}
        </button>
        <h1 className="text-2xl font-semibold text-slate-900">Edit Job</h1>
        {originalJobId && (
          <p className="text-sm text-slate-500 mt-0.5 font-mono">{originalJobId}</p>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5">
          {error && (
            <div className="px-4 py-3 rounded-lg bg-red-50 text-red-800 border border-red-200 text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="title" className="block text-sm font-medium text-slate-700 mb-1">
              Job Title <span className="text-red-500">*</span>
            </label>
            <input
              id="title"
              type="text"
              value={form.title}
              onChange={(e) => handleChange("title", e.target.value)}
              className={`w-full px-3 py-2 rounded-lg border text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${
                titleError ? "border-red-300 bg-red-50" : "border-slate-300"
              }`}
            />
            {titleError && <p className="mt-1 text-xs text-red-600">Title is required</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="department" className="block text-sm font-medium text-slate-700 mb-1">
                Department
              </label>
              <input
                id="department"
                type="text"
                value={form.department}
                onChange={(e) => handleChange("department", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div>
              <label htmlFor="location" className="block text-sm font-medium text-slate-700 mb-1">
                Location
              </label>
              <input
                id="location"
                type="text"
                value={form.location}
                onChange={(e) => handleChange("location", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>

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

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              First-Round Interview Mode
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(
                [
                  { value: "voice" as const, title: "Voice Interview", desc: "ElevenLabs AI voice screen with face tracking." },
                  { value: "qa" as const, title: "Written Q&A", desc: "3 LLM-generated rounds: aptitude, reasoning, CV-based." },
                ]
              ).map((opt) => {
                const selected = form.interview_mode === opt.value;
                return (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => setForm((prev) => ({ ...prev, interview_mode: opt.value }))}
                    className={`text-left rounded-lg border p-3 transition-all ${
                      selected
                        ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${selected ? "border-indigo-600" : "border-slate-300"}`}>
                        {selected && <span className="w-2 h-2 rounded-full bg-indigo-600" />}
                      </span>
                      <span className="text-sm font-semibold text-slate-900">{opt.title}</span>
                    </div>
                    <p className="text-xs text-slate-500 leading-snug">{opt.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Expiry date */}
          <div>
            <label htmlFor="expires_at" className="block text-sm font-medium text-slate-700 mb-1">
              Expiry date <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="expires_at"
                type="date"
                value={form.expires_at || ""}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, expires_at: e.target.value }))
                }
                min={new Date().toISOString().slice(0, 10)}
                className="px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              {form.expires_at && (
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, expires_at: "" }))}
                  className="text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              After this date the job is treated as closed: the auto-pipeline
              stops matching new candidates and the default jobs list hides it.
            </p>
          </div>

          {/* Score thresholds — drive auto-advance / auto-reject in screening */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <label className="block text-sm font-medium text-slate-700">
                Score thresholds
              </label>
              <button
                type="button"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    resume_threshold_min: 80,
                    interview_threshold_min: 75,
                    final_threshold_reject: 50,
                  }))
                }
                className="text-[11px] font-medium text-slate-500 hover:text-slate-900"
              >
                Reset to defaults
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="resume_threshold_min" className="block text-xs text-slate-600 mb-1">
                  Resume min (advance)
                </label>
                <div className="relative">
                  <input
                    id="resume_threshold_min"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={form.resume_threshold_min ?? 80}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        resume_threshold_min: Number(e.target.value),
                      }))
                    }
                    className="w-full pl-3 pr-7 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
                </div>
              </div>
              <div>
                <label htmlFor="interview_threshold_min" className="block text-xs text-slate-600 mb-1">
                  Interview min (advance)
                </label>
                <div className="relative">
                  <input
                    id="interview_threshold_min"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={form.interview_threshold_min ?? 75}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        interview_threshold_min: Number(e.target.value),
                      }))
                    }
                    className="w-full pl-3 pr-7 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
                </div>
              </div>
              <div>
                <label htmlFor="final_threshold_reject" className="block text-xs text-slate-600 mb-1">
                  Final reject below
                </label>
                <div className="relative">
                  <input
                    id="final_threshold_reject"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={form.final_threshold_reject ?? 50}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        final_threshold_reject: Number(e.target.value),
                      }))
                    }
                    className="w-full pl-3 pr-7 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
                </div>
              </div>
            </div>
            <p className="mt-1.5 text-xs text-slate-500 leading-snug">
              Auto-advance when resume score ≥ resume-min <em>and</em>{" "}
              interview score ≥ interview-min. Auto-reject when final score &lt;
              reject-below. Otherwise the candidate is held for manual review.
            </p>
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
                placeholder="Comma-separated, press Enter to add"
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
                      aria-label={`Remove ${skill}`}
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

          {/* Responsibilities — editable inline (key difference from Create) */}
          <BulletEditor
            label="Responsibilities"
            items={form.responsibilities}
            input={respInput}
            setInput={setRespInput}
            onAdd={() => addBullet("responsibilities", respInput, setRespInput)}
            onRemove={(idx) => removeBullet("responsibilities", idx)}
            bulletColor="text-indigo-400"
            bulletChar="•"
          />

          <BulletEditor
            label="Qualifications"
            items={form.qualifications}
            input={qualInput}
            setInput={setQualInput}
            onAdd={() => addBullet("qualifications", qualInput, setQualInput)}
            onRemove={(idx) => removeBullet("qualifications", idx)}
            bulletColor="text-emerald-400"
            bulletChar="✓"
          />

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-slate-700 mb-1">
              Description
            </label>
            <textarea
              id="description"
              value={form.description}
              onChange={(e) => handleChange("description", e.target.value)}
              rows={8}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-vertical"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={() => router.push(`/jobs/${jobId}`)}
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
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function BulletEditor({
  label,
  items,
  input,
  setInput,
  onAdd,
  onRemove,
  bulletColor,
  bulletChar,
}: {
  label: string;
  items: string[];
  input: string;
  setInput: (s: string) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
  bulletColor: string;
  bulletChar: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
          placeholder={`Add a ${label.toLowerCase().slice(0, -1)} and press Enter`}
          className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
        <button
          type="button"
          onClick={onAdd}
          className="px-4 py-2 text-sm font-medium rounded-lg text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors"
        >
          Add
        </button>
      </div>
      {items.length > 0 && (
        <ul className="space-y-1.5 mt-2">
          {items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2 group px-2 py-1 hover:bg-slate-50 rounded">
              <span className={`${bulletColor} mt-0.5 text-sm`}>{bulletChar}</span>
              <span className="flex-1 text-sm text-slate-700">{item}</span>
              <button
                type="button"
                onClick={() => onRemove(idx)}
                className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-all"
                aria-label="Remove"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
