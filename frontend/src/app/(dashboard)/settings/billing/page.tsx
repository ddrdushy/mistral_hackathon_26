"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  CreditCardIcon,
  CheckIcon,
  ArrowTopRightOnSquareIcon,
  SparklesIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";

import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthGate";
import type {
  Plan,
  CurrentPlan,
  UsageSummary,
  PlanName,
  UsageItem,
} from "@/types/index";
import LoadingSpinner from "@/components/ui/LoadingSpinner";

function BillingInner() {
  const { me } = useAuth();
  const params = useSearchParams();
  const isOwner = me?.user.role === "owner";

  const [plans, setPlans] = useState<Plan[]>([]);
  const [current, setCurrent] = useState<CurrentPlan | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingPlan, setPendingPlan] = useState<PlanName | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upgraded = params.get("upgraded") === "1";
  const canceled = params.get("canceled") === "1";

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [plansData, currentData, usageData] = await Promise.all([
        apiGet<Plan[]>("/billing/plans"),
        apiGet<CurrentPlan>("/billing/me"),
        apiGet<UsageSummary>("/billing/usage"),
      ]);
      setPlans(plansData);
      setCurrent(currentData);
      setUsage(usageData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load billing");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleUpgrade = async (plan: PlanName) => {
    setPendingPlan(plan);
    setError(null);
    try {
      const { url } = await apiPost<{ url: string }>("/billing/checkout", { plan });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start checkout");
      setPendingPlan(null);
    }
  };

  const handlePortal = async () => {
    setPendingPlan("pro"); // any non-null
    setError(null);
    try {
      const { url } = await apiPost<{ url: string }>("/billing/portal");
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open portal");
      setPendingPlan(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <CreditCardIcon className="h-5 w-5 text-indigo-600" />
          <h1 className="text-2xl font-semibold text-slate-900">Billing & usage</h1>
        </div>
        <p className="text-sm text-slate-500">
          Your plan, usage, and subscription for <strong>{me?.tenant.name}</strong>.
        </p>
      </div>

      {/* Banners */}
      {upgraded && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          ✓ Upgrade complete. Your new quotas are active.
        </div>
      )}
      {canceled && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Checkout canceled. No charge was made.
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Current plan + usage */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-1 bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">
            Current plan
          </p>
          <p className="text-2xl font-bold text-slate-900">{current?.display_name}</p>
          {current?.subscription_status && (
            <p className="text-xs text-slate-500 mt-1 capitalize">
              {current.subscription_status.replace(/_/g, " ")}
            </p>
          )}
          {current?.current_period_end && (
            <p className="text-xs text-slate-400 mt-2">
              Renews {new Date(current.current_period_end).toLocaleDateString()}
            </p>
          )}
          {isOwner && current?.cancel_url_available && (
            <button
              type="button"
              onClick={handlePortal}
              disabled={pendingPlan !== null}
              className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors disabled:opacity-50"
            >
              <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
              Manage subscription
            </button>
          )}
        </div>

        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-3">
            Usage this month
          </p>
          <div className="space-y-3">
            {usage && (
              <>
                <UsageBar label="Jobs" item={usage.jobs} />
                <UsageBar label="Candidates" item={usage.candidates} />
                <UsageBar label="Interviews" item={usage.interviews_this_month} />
                <LlmBudgetBar
                  spent={usage.llm_today.spent_usd}
                  budget={usage.llm_today.budget_usd}
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Plans */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((p) => {
            const isCurrent = current?.plan === p.name;
            const canUpgrade = isOwner && !isCurrent && p.available && p.name !== "free";
            return (
              <div
                key={p.name}
                className={`rounded-xl p-5 border ${
                  isCurrent
                    ? "bg-indigo-50/40 border-indigo-300 ring-1 ring-indigo-300"
                    : "bg-white border-slate-200"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-slate-700">{p.display_name}</p>
                  {isCurrent && (
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-600 text-white font-bold">
                      Current
                    </span>
                  )}
                </div>
                <p className="text-3xl font-bold text-slate-900 mb-3">
                  {p.price_monthly_usd === 0
                    ? "$0"
                    : `$${p.price_monthly_usd}`}
                  <span className="text-sm font-medium text-slate-500">
                    {p.price_monthly_usd > 0 ? " / mo" : ""}
                  </span>
                </p>
                <ul className="space-y-1.5 mb-4">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs text-slate-600">
                      <CheckIcon className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                {!p.available && p.name !== "free" && (
                  <div className="rounded-md bg-amber-50 border border-amber-200 px-2 py-1.5 mb-3">
                    <p className="text-[11px] text-amber-700 flex items-start gap-1.5">
                      <ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      Not configured. Set STRIPE_{p.name.toUpperCase()}_PRICE_ID.
                    </p>
                  </div>
                )}
                {canUpgrade && (
                  <button
                    type="button"
                    onClick={() => handleUpgrade(p.name)}
                    disabled={pendingPlan !== null}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    <SparklesIcon className="w-4 h-4" />
                    {pendingPlan === p.name ? "Redirecting..." : `Upgrade to ${p.display_name}`}
                  </button>
                )}
                {isCurrent && (
                  <p className="text-xs text-slate-400 text-center">You&apos;re on this plan</p>
                )}
                {!isOwner && p.name !== "free" && !isCurrent && (
                  <p className="text-xs text-slate-400 text-center">Owner-only action</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LlmBudgetBar({ spent, budget }: { spent: number; budget: number }) {
  const unlimited = budget < 0;
  const pct = unlimited ? 0 : Math.min(100, Math.round((spent / Math.max(0.01, budget)) * 100));
  const tone = unlimited
    ? "bg-emerald-500"
    : pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-medium text-slate-600">
          AI spend today
          <span className="ml-1 text-[10px] text-slate-400 uppercase tracking-wider">UTC</span>
        </span>
        <span className="font-semibold tabular-nums text-slate-700">
          ${spent.toFixed(2)} {unlimited ? "/ ∞" : `/ $${budget.toFixed(2)}`}
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: unlimited ? "100%" : `${pct}%`, opacity: unlimited ? 0.4 : 1 }}
        />
      </div>
    </div>
  );
}

function UsageBar({ label, item }: { label: string; item: UsageItem }) {
  const unlimited = item.limit < 0;
  const pct = unlimited ? 0 : Math.min(100, Math.round((item.used / Math.max(1, item.limit)) * 100));
  const tone =
    unlimited
      ? "bg-emerald-500"
      : pct >= 90
        ? "bg-red-500"
        : pct >= 70
          ? "bg-amber-500"
          : "bg-indigo-500";

  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-medium text-slate-600">{label}</span>
        <span className="font-semibold tabular-nums text-slate-700">
          {item.used} {unlimited ? "/ ∞" : `/ ${item.limit}`}
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: unlimited ? "100%" : `${pct}%`, opacity: unlimited ? 0.4 : 1 }}
        />
      </div>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense>
      <BillingInner />
    </Suspense>
  );
}
