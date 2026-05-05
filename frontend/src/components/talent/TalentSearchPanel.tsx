"use client";

import { useState } from "react";
import { apiPost } from "@/lib/api";

interface TalentMatch {
  name: string;
  email: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  years_experience: number | null;
  skills: string[];
  profile_url: string | null;
  linkedin_url: string | null;
  provider: string;
  external_id: string | null;
  fit_score: number;
  fit_reasoning: string;
}

interface SearchResponse {
  job_id: string;
  query: {
    title: string;
    seniority: string;
    location: string;
    skills: string[];
  };
  matches: TalentMatch[];
  provider: string | null;
}

interface Props {
  jobId: string;        // the JOB-YYYY-NNN string
  onShowToast: (msg: string, type?: "success" | "error") => void;
}

export default function TalentSearchPanel({ jobId, onShowToast }: Props) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);

  const isMock = result?.provider === "apollo_mock";

  const runSearch = async () => {
    setRunning(true);
    try {
      const data = await apiPost<SearchResponse>(
        `/jobs/${jobId}/search-talent`,
        { limit: 20 },
      );
      setResult(data);
      if (data.matches.length === 0) {
        onShowToast("Search returned no candidates — try adjusting the job description", "error");
      }
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : "Search failed", "error");
    } finally {
      setRunning(false);
    }
  };

  const handleOutreach = (m: TalentMatch) => {
    if (!m.email) {
      onShowToast(`No email on file for ${m.name} — try the profile link`, "error");
      return;
    }
    // Hand-off — opens a draft email; later this will queue via the connected
    // mailbox + outreach agent.
    const subject = encodeURIComponent(`Opportunity at our team — ${result?.query.title}`);
    const body = encodeURIComponent(
      `Hi ${m.name.split(" ")[0]},\n\nI came across your background as a ${m.title || "candidate"} and thought you might be a strong fit for a role we're hiring for. Open to a quick chat?\n\n— Sent via HireOps AI`,
    );
    window.location.href = `mailto:${m.email}?subject=${subject}&body=${body}`;
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">AI Talent Search</h2>
          <p className="text-sm text-slate-500">
            Source candidates that match this job — uses Apollo by default, plus any LinkedIn / Indeed / JobStreet subscriptions you&apos;ve connected.
          </p>
        </div>
        <button
          onClick={runSearch}
          disabled={running}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {running ? (
            <>
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Searching…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {result ? "Re-run search" : "Search talent"}
            </>
          )}
        </button>
      </div>

      {result && (
        <>
          {isMock && (
            <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 mb-4 text-[12px] text-amber-800">
              <strong>Demo mode:</strong> showing sample results because no Apollo API key is configured. Set <code className="px-1 bg-amber-100 rounded">APOLLO_API_KEY</code> in the platform settings to query the real Apollo database.
            </div>
          )}

          <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 mb-4 text-[12px] text-slate-600">
            <strong>Query:</strong>{" "}
            {result.query.title || "(any role)"}
            {result.query.seniority && ` · ${result.query.seniority}`}
            {result.query.location && ` · ${result.query.location}`}
            {result.query.skills.length > 0 && ` · skills: ${result.query.skills.join(", ")}`}
          </div>

          {result.matches.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
              No candidates matched. Try widening the location or relaxing required skills on the job.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 -mx-2">
              {result.matches.map((m, i) => (
                <li key={`${m.external_id}-${i}`} className="px-2 py-3 hover:bg-slate-50/60 rounded-md">
                  <div className="flex items-start gap-3">
                    <FitBadge score={m.fit_score} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-sm font-semibold text-slate-900 truncate">{m.name}</div>
                        {m.profile_url && (
                          <a
                            href={m.profile_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-indigo-600 hover:underline"
                          >
                            View profile ↗
                          </a>
                        )}
                        {m.provider === "apollo_mock" && (
                          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">
                            Demo
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5">
                        {m.title || "—"}
                        {m.company && <> at {m.company}</>}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                        {m.location && <span>📍 {m.location}</span>}
                        {m.years_experience != null && <span>{m.years_experience} yrs experience</span>}
                        {m.email && <span className="font-mono">{m.email}</span>}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1 italic line-clamp-2">
                        {m.fit_reasoning}
                      </div>
                      {m.skills.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {m.skills.slice(0, 6).map((s) => (
                            <span
                              key={s}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <button
                        onClick={() => handleOutreach(m)}
                        disabled={!m.email}
                        className="text-[11px] px-2 py-1 rounded text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        title={m.email ? "Draft outreach" : "No email on file"}
                      >
                        Outreach
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {!result && !running && (
        <div className="rounded-md border border-dashed border-slate-200 bg-slate-50/40 p-8 text-center">
          <svg className="w-8 h-8 text-slate-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <div className="text-sm font-medium text-slate-700">Find candidates without waiting</div>
          <div className="text-xs text-slate-500 mt-0.5">
            Click <strong>Search talent</strong> to source candidates that match this role&apos;s skills, seniority, and location.
          </div>
        </div>
      )}
    </div>
  );
}

function FitBadge({ score }: { score: number }) {
  const tone =
    score >= 80
      ? { bg: "bg-emerald-100", text: "text-emerald-800", label: "Strong fit" }
      : score >= 65
      ? { bg: "bg-indigo-100", text: "text-indigo-800", label: "Good fit" }
      : score >= 50
      ? { bg: "bg-amber-100", text: "text-amber-800", label: "Partial" }
      : { bg: "bg-slate-200", text: "text-slate-700", label: "Weak" };
  return (
    <div className={`flex flex-col items-center justify-center rounded-md ${tone.bg} ${tone.text} px-2 py-1.5 min-w-[3rem] flex-shrink-0`}>
      <div className="text-base font-bold tabular-nums leading-none">{score}</div>
      <div className="text-[9px] uppercase tracking-wider mt-0.5 leading-none">{tone.label}</div>
    </div>
  );
}
