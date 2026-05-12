"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { apiGet, apiPut, apiDelete } from "@/lib/api";

interface PlanConfig {
  name: string;
  display_name: string;
  price_monthly_usd: number;
  stripe_price_id: string | null;
  max_jobs: number;
  max_candidates: number;
  max_interviews_per_month: number;
  daily_llm_budget_usd: number;
  llm_markup_multiplier: number;
  features: string[];
  allowed_agents: string[]; // ["*"] or list
  has_override: boolean;
}

const AGENT_LABELS: Record<string, string> = {
  email_classifier: "Inbox classifier",
  resume_scorer: "Resume scorer",
  profile_extractor: "Talent-bank tagger",
  interview_question_generator: "AI interview-question suggest",
  voice_screener: "Voice screening (ElevenLabs)",
  qa_interview_generate: "Q&A interview generator",
  qa_interview_score_technical: "Q&A technical scorer",
  interview_evaluator: "Interview evaluator",
  hiring_report: "Hiring report generator",
  talent_search: "External talent search (Apollo)",
  job_generator: "Job description auto-fill",
};
const ALL_AGENTS_FE = Object.keys(AGENT_LABELS);

export default function PlansAdminPage() {
  const [plans, setPlans] = useState<PlanConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiGet<PlanConfig[]>("/admin/plan-configs");
      setPlans(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Plans</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Edit price, limits, features, and which AI agents each plan
            unlocks. Changes take effect within 30 seconds (override cache TTL).
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-md"
        >
          <ArrowPathIcon className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {error && (
        <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-48 bg-white border border-slate-200 rounded-xl animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {plans.map((p) => (
            <PlanEditorCard key={p.name} plan={p} onSaved={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanEditorCard({
  plan,
  onSaved,
}: {
  plan: PlanConfig;
  onSaved: () => void;
}) {
  const [edit, setEdit] = useState({
    display_name: plan.display_name,
    price_monthly_usd: plan.price_monthly_usd,
    stripe_price_id: plan.stripe_price_id || "",
    max_jobs: plan.max_jobs,
    max_candidates: plan.max_candidates,
    max_interviews_per_month: plan.max_interviews_per_month,
    daily_llm_budget_usd: plan.daily_llm_budget_usd,
    features: plan.features.join("\n"),
    allowed_all: plan.allowed_agents.includes("*"),
    allowed_set: new Set(plan.allowed_agents.filter((a) => a !== "*")),
  });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-sync local edit state when the parent re-fetches the plan after a
  // save / reset. Without this, useState's initial values stick forever
  // and the input keeps showing pre-save text even though DB has new data.
  useEffect(() => {
    setEdit({
      display_name: plan.display_name,
      price_monthly_usd: plan.price_monthly_usd,
      stripe_price_id: plan.stripe_price_id || "",
      max_jobs: plan.max_jobs,
      max_candidates: plan.max_candidates,
      max_interviews_per_month: plan.max_interviews_per_month,
      daily_llm_budget_usd: plan.daily_llm_budget_usd,
      llm_markup_multiplier: plan.llm_markup_multiplier,
      features: plan.features.join("\n"),
      allowed_all: plan.allowed_agents.includes("*"),
      allowed_set: new Set(plan.allowed_agents.filter((a) => a !== "*")),
    });
  }, [
    plan.display_name,
    plan.price_monthly_usd,
    plan.stripe_price_id,
    plan.max_jobs,
    plan.max_candidates,
    plan.max_interviews_per_month,
    plan.daily_llm_budget_usd,
    plan.llm_markup_multiplier,
    plan.features,
    plan.allowed_agents,
  ]);

  const save = async () => {
    try {
      setBusy(true);
      setError(null);
      setFeedback(null);
      const allowedAgents = edit.allowed_all
        ? ["*"]
        : Array.from(edit.allowed_set);
      const features = edit.features
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      await apiPut(`/admin/plan-configs/${plan.name}`, {
        display_name: edit.display_name,
        price_monthly_usd: edit.price_monthly_usd,
        stripe_price_id: edit.stripe_price_id || null,
        max_jobs: edit.max_jobs,
        max_candidates: edit.max_candidates,
        max_interviews_per_month: edit.max_interviews_per_month,
        daily_llm_budget_usd: edit.daily_llm_budget_usd,
        llm_markup_multiplier: edit.llm_markup_multiplier,
        features,
        allowed_agents: allowedAgents,
      });
      setFeedback("Saved");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (
      !confirm(
        `Reset ${plan.display_name} to env-driven defaults? Any DB overrides will be removed.`,
      )
    )
      return;
    try {
      setBusy(true);
      setError(null);
      setFeedback(null);
      await apiDelete(`/admin/plan-configs/${plan.name}`);
      setFeedback("Reset to defaults");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  };

  const toggleAgent = (agent: string) => {
    setEdit((cur) => {
      const next = new Set(cur.allowed_set);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return { ...cur, allowed_set: next };
    });
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
        <h3 className="text-base font-semibold text-slate-900">
          {plan.display_name}
        </h3>
        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
          {plan.name}
        </span>
        {plan.has_override && (
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
            override
          </span>
        )}
      </div>
      <div className="px-6 py-4 space-y-3 text-sm">
        <Field label="Display name">
          <input
            type="text"
            value={edit.display_name}
            onChange={(e) => setEdit({ ...edit, display_name: e.target.value })}
            className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded"
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Price (USD/mo)">
            <input
              type="number"
              value={edit.price_monthly_usd}
              onChange={(e) =>
                setEdit({ ...edit, price_monthly_usd: Number(e.target.value) || 0 })
              }
              className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded"
            />
          </Field>
          <Field label="Daily LLM budget USD">
            <input
              type="number"
              step="0.10"
              value={edit.daily_llm_budget_usd}
              onChange={(e) =>
                setEdit({
                  ...edit,
                  daily_llm_budget_usd: Number(e.target.value) || 0,
                })
              }
              className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded"
            />
          </Field>
        </div>

        <Field label="LLM markup multiplier">
          <input
            type="number"
            step="0.1"
            min="0"
            value={edit.llm_markup_multiplier}
            onChange={(e) =>
              setEdit({
                ...edit,
                llm_markup_multiplier: Number(e.target.value) || 0,
              })
            }
            className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded"
          />
          <p className="text-[11px] text-slate-500 mt-1">
            Tenants on this plan see their AI cost multiplied by this number.
            1.0 = pass-through (no markup). 2.5 = 250% markup. Used by
            <code className="font-mono mx-1">/settings/llm/usage</code> so
            recruiters never see raw provider cost.
          </p>
        </Field>

        <Field label="Stripe price ID">
          <input
            type="text"
            value={edit.stripe_price_id}
            onChange={(e) =>
              setEdit({ ...edit, stripe_price_id: e.target.value })
            }
            placeholder="price_..."
            className="w-full px-2 py-1.5 text-sm font-mono border border-slate-300 rounded"
          />
          <p className="text-[11px] text-slate-500 mt-1">
            Leave blank to fall back to env. Stripe prices are immutable —
            create a new price in Stripe and paste its ID here to switch tiers.
          </p>
        </Field>

        <div className="grid grid-cols-3 gap-2">
          <Field label="Max jobs">
            <input
              type="number"
              value={edit.max_jobs}
              onChange={(e) =>
                setEdit({ ...edit, max_jobs: Number(e.target.value) || 0 })
              }
              className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded"
            />
          </Field>
          <Field label="Max candidates">
            <input
              type="number"
              value={edit.max_candidates}
              onChange={(e) =>
                setEdit({
                  ...edit,
                  max_candidates: Number(e.target.value) || 0,
                })
              }
              className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded"
            />
          </Field>
          <Field label="Interviews/mo">
            <input
              type="number"
              value={edit.max_interviews_per_month}
              onChange={(e) =>
                setEdit({
                  ...edit,
                  max_interviews_per_month: Number(e.target.value) || 0,
                })
              }
              className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded"
            />
          </Field>
        </div>
        <p className="text-[11px] text-slate-500 -mt-1">
          Use <code>-1</code> for unlimited.
        </p>

        <Field label="Features (one per line)">
          <textarea
            value={edit.features}
            onChange={(e) => setEdit({ ...edit, features: e.target.value })}
            rows={4}
            className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded"
          />
        </Field>

        <div>
          <label className="flex items-center gap-2 mb-2 text-sm">
            <input
              type="checkbox"
              checked={edit.allowed_all}
              onChange={(e) =>
                setEdit({ ...edit, allowed_all: e.target.checked })
              }
              className="rounded border-slate-300"
            />
            <span className="font-medium text-slate-700">All agents allowed</span>
          </label>
          {!edit.allowed_all && (
            <div className="border border-slate-200 rounded-md p-2 max-h-48 overflow-y-auto space-y-1">
              {ALL_AGENTS_FE.map((a) => (
                <label
                  key={a}
                  className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer hover:bg-slate-50 px-1 py-0.5 rounded"
                >
                  <input
                    type="checkbox"
                    checked={edit.allowed_set.has(a)}
                    onChange={() => toggleAgent(a)}
                    className="rounded border-slate-300"
                  />
                  {AGENT_LABELS[a] || a}
                </label>
              ))}
            </div>
          )}
          {/* Precedence note — the audit flagged that the resolution
              order wasn't visible anywhere in the UI, leading to confusion
              when a tenant override differed from the plan setting. */}
          <div className="mt-2 rounded-md bg-slate-50 border border-slate-200 px-2 py-1.5 text-[11px] text-slate-600 leading-snug">
            <span className="font-semibold text-slate-700">Resolution order:</span>{" "}
            per-tenant override (Admin → Tenant → Agent overrides) wins over
            this plan-level allow list, which wins over the static defaults
            in <code className="font-mono">billing/plans.py</code>. The
            tenant&apos;s effective allow list is the union of all three.
          </div>
        </div>

        {feedback && (
          <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 flex items-center gap-1">
            <CheckCircleIcon className="h-3.5 w-3.5" />
            {feedback}
          </p>
        )}
        {error && (
          <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1 flex items-center gap-1">
            <ExclamationTriangleIcon className="h-3.5 w-3.5" />
            {error}
          </p>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={reset}
            disabled={busy || !plan.has_override}
            className="text-xs text-rose-600 hover:text-rose-800 disabled:text-slate-400 disabled:cursor-not-allowed"
            title={plan.has_override ? "Drop DB override, use env defaults" : "No override to reset"}
          >
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50"
          >
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
