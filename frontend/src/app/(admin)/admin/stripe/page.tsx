"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { apiGet, apiPut, apiPost, apiDelete } from "@/lib/api";

type Mode = "sandbox" | "prod";

interface StripeModeCreds {
  secret_key: string;
  publishable_key: string;
  webhook_secret: string;
  starter_price_id: string;
  pro_price_id: string;
  secret_key_set: boolean;
  publishable_key_set: boolean;
  webhook_secret_set: boolean;
  starter_price_id_set: boolean;
  pro_price_id_set: boolean;
}

interface StripeConfig {
  mode: Mode;
  sandbox: StripeModeCreds;
  prod: StripeModeCreds;
  env_fallbacks_present: Record<string, boolean>;
}

export default function StripeConfigPage() {
  const [data, setData] = useState<StripeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyMode, setBusyMode] = useState<Mode | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiGet<StripeConfig>("/admin/stripe-config");
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const switchMode = async (mode: Mode) => {
    if (!data || data.mode === mode) return;
    if (
      mode === "prod" &&
      !confirm(
        "Switch to PRODUCTION mode? Real payments will be processed. Make sure prod keys are correctly configured.",
      )
    ) {
      return;
    }
    try {
      setError(null);
      setFeedback(null);
      const res = await apiPut<StripeConfig>("/admin/stripe-config/mode", { mode });
      setData(res);
      setFeedback(
        mode === "prod"
          ? "Switched to PRODUCTION mode — real payments active"
          : "Switched to sandbox mode — test payments only",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Switch failed");
    }
  };

  const wipeMode = async (mode: Mode) => {
    if (
      !confirm(
        `Wipe all ${mode.toUpperCase()} credentials? The app will fall back to env vars (if any) for that mode.`,
      )
    )
      return;
    try {
      setBusyMode(mode);
      setError(null);
      setFeedback(null);
      await apiDelete(`/admin/stripe-config/${mode}`);
      await load();
      setFeedback(`${mode.toUpperCase()} credentials cleared`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setBusyMode(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-12 bg-white border border-slate-200 rounded animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-96 bg-white border border-slate-200 rounded-xl animate-pulse" />
          <div className="h-96 bg-white border border-slate-200 rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <p className="text-sm text-slate-500">
        {error || "Could not load Stripe config."}
      </p>
    );
  }

  const isProd = data.mode === "prod";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          Stripe configuration
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Two parallel credential sets. The toggle below decides which one
          the platform actually uses for checkout, portal, and webhook
          verification.
        </p>
      </div>

      {/* Mode toggle */}
      <div
        className={`rounded-xl border p-5 ${
          isProd
            ? "bg-rose-50 border-rose-300"
            : "bg-amber-50 border-amber-300"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-600 mb-1">
              Active mode
            </p>
            <h2
              className={`text-2xl font-bold flex items-center gap-2 ${
                isProd ? "text-rose-900" : "text-amber-900"
              }`}
            >
              {isProd ? "🔴 PRODUCTION" : "🟡 SANDBOX"}
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              {isProd
                ? "Real payments. Real cards. Real money. Live webhooks."
                : "Test mode. No real charges. Use Stripe test cards (4242 4242 4242 4242)."}
            </p>
          </div>
          <div className="inline-flex rounded-md shadow-sm bg-white border border-slate-300 overflow-hidden">
            <button
              type="button"
              onClick={() => switchMode("sandbox")}
              disabled={data.mode === "sandbox"}
              className={`px-4 py-2 text-sm font-medium ${
                data.mode === "sandbox"
                  ? "bg-amber-500 text-white"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              Sandbox
            </button>
            <button
              type="button"
              onClick={() => switchMode("prod")}
              disabled={data.mode === "prod"}
              className={`px-4 py-2 text-sm font-medium border-l border-slate-300 ${
                data.mode === "prod"
                  ? "bg-rose-600 text-white"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              Production
            </button>
          </div>
        </div>
      </div>

      {feedback && (
        <p className="text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-md px-3 py-2 flex items-center gap-2">
          <CheckCircleIcon className="h-4 w-4" />
          {feedback}
        </p>
      )}
      {error && (
        <p className="text-sm bg-rose-50 border border-rose-200 text-rose-800 rounded-md px-3 py-2 flex items-center gap-2">
          <ExclamationTriangleIcon className="h-4 w-4" />
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ModeCard
          mode="sandbox"
          active={data.mode === "sandbox"}
          values={data.sandbox}
          envFallbacks={data.env_fallbacks_present}
          busy={busyMode === "sandbox"}
          onSaved={load}
          onWipe={() => wipeMode("sandbox")}
        />
        <ModeCard
          mode="prod"
          active={data.mode === "prod"}
          values={data.prod}
          envFallbacks={data.env_fallbacks_present}
          busy={busyMode === "prod"}
          onSaved={load}
          onWipe={() => wipeMode("prod")}
        />
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-600">
        <p className="font-medium text-slate-800 mb-2">How this works</p>
        <ul className="space-y-1 text-xs">
          <li>
            • Each mode stores its own secret key, publishable key, webhook
            secret, and per-plan price IDs.
          </li>
          <li>
            • The active toggle decides which set is used by checkout, the
            customer portal, and webhook signature verification.
          </li>
          <li>
            • Empty fields fall back to the corresponding env var
            (<code className="font-mono">STRIPE_SECRET_KEY</code>,
            <code className="font-mono"> STRIPE_WEBHOOK_SECRET</code>, etc.) so
            existing single-set deploys keep working.
          </li>
          <li>
            • Webhook URL stays the same — re-point the prod webhook in
            Stripe to your prod backend; sandbox webhook to your dev
            backend (or the same with a separate signing secret).
          </li>
          <li>
            • Stripe prices are immutable — to change a tier price, create
            a new Price in the Stripe dashboard and paste its ID here.
          </li>
        </ul>
      </div>
    </div>
  );
}

function ModeCard({
  mode,
  active,
  values,
  envFallbacks,
  busy,
  onSaved,
  onWipe,
}: {
  mode: Mode;
  active: boolean;
  values: StripeModeCreds;
  envFallbacks: Record<string, boolean>;
  busy: boolean;
  onSaved: () => void;
  onWipe: () => void;
}) {
  const [draft, setDraft] = useState({
    secret_key: "",
    publishable_key: "",
    webhook_secret: "",
    starter_price_id: "",
    pro_price_id: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    checks: { name: string; ok: boolean; detail: string }[];
  } | null>(null);

  // Pre-populate non-secret values from server state
  useEffect(() => {
    setDraft({
      secret_key: "",
      publishable_key: values.publishable_key || "",
      webhook_secret: "",
      starter_price_id: values.starter_price_id || "",
      pro_price_id: values.pro_price_id || "",
    });
  }, [
    values.publishable_key,
    values.starter_price_id,
    values.pro_price_id,
  ]);

  const save = async () => {
    try {
      setSaving(true);
      setError(null);
      setFeedback(null);
      // Only send fields the user actually touched (non-empty); empty
      // strings would clear the row.
      const payload: Record<string, string> = {};
      if (draft.secret_key.trim())
        payload.secret_key = draft.secret_key.trim();
      // publishable_key + price_id sync the form value (allows clearing
      // by typing then deleting then save)
      if (draft.publishable_key !== values.publishable_key)
        payload.publishable_key = draft.publishable_key.trim();
      if (draft.webhook_secret.trim())
        payload.webhook_secret = draft.webhook_secret.trim();
      if (draft.starter_price_id !== values.starter_price_id)
        payload.starter_price_id = draft.starter_price_id.trim();
      if (draft.pro_price_id !== values.pro_price_id)
        payload.pro_price_id = draft.pro_price_id.trim();

      if (Object.keys(payload).length === 0) {
        setFeedback("No changes to save");
        return;
      }
      await apiPut(`/admin/stripe-config/${mode}`, payload);
      setFeedback("Saved");
      // Reset secret-input fields after save
      setDraft((d) => ({ ...d, secret_key: "", webhook_secret: "" }));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    try {
      setTesting(true);
      setError(null);
      setFeedback(null);
      setTestResult(null);
      const res = await apiPost<{
        ok: boolean;
        checks: { name: string; ok: boolean; detail: string }[];
      }>(`/admin/stripe-config/${mode}/test`);
      setTestResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  const isProd = mode === "prod";
  const cardBorder = active
    ? isProd
      ? "border-rose-400 ring-2 ring-rose-200"
      : "border-amber-400 ring-2 ring-amber-200"
    : "border-slate-200";

  return (
    <div
      className={`bg-white rounded-xl border shadow-sm ${cardBorder}`}
    >
      <div
        className={`px-6 py-3 border-b border-slate-200 flex items-center justify-between ${
          active ? (isProd ? "bg-rose-50" : "bg-amber-50") : ""
        }`}
      >
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-900">
            {isProd ? "Production" : "Sandbox"}
          </h2>
          {active && (
            <span
              className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold ${
                isProd
                  ? "bg-rose-200 text-rose-900"
                  : "bg-amber-200 text-amber-900"
              }`}
            >
              Active
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onWipe}
          disabled={busy}
          className="text-xs font-medium text-rose-600 hover:text-rose-800 disabled:opacity-50 inline-flex items-center gap-1"
        >
          <TrashIcon className="h-3.5 w-3.5" />
          Wipe
        </button>
      </div>
      <div className="px-6 py-4 space-y-3">
        <SecretField
          label="Secret key"
          placeholder={isProd ? "sk_live_..." : "sk_test_..."}
          masked={values.secret_key}
          isSet={values.secret_key_set}
          envFallback={envFallbacks.secret_key}
          value={draft.secret_key}
          onChange={(v) => setDraft({ ...draft, secret_key: v })}
        />
        <Field
          label="Publishable key"
          placeholder={isProd ? "pk_live_..." : "pk_test_..."}
          value={draft.publishable_key}
          onChange={(v) => setDraft({ ...draft, publishable_key: v })}
        />
        <SecretField
          label="Webhook signing secret"
          placeholder="whsec_..."
          masked={values.webhook_secret}
          isSet={values.webhook_secret_set}
          envFallback={envFallbacks.webhook_secret}
          value={draft.webhook_secret}
          onChange={(v) => setDraft({ ...draft, webhook_secret: v })}
        />
        <Field
          label="Starter price ID"
          placeholder="price_..."
          value={draft.starter_price_id}
          onChange={(v) => setDraft({ ...draft, starter_price_id: v })}
        />
        <Field
          label="Pro price ID"
          placeholder="price_..."
          value={draft.pro_price_id}
          onChange={(v) => setDraft({ ...draft, pro_price_id: v })}
        />

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

        {testResult && (
          <div
            className={`rounded-md border p-2 space-y-1 text-xs ${
              testResult.ok
                ? "bg-emerald-50 border-emerald-200"
                : "bg-rose-50 border-rose-200"
            }`}
          >
            <p
              className={`font-semibold ${
                testResult.ok ? "text-emerald-800" : "text-rose-800"
              }`}
            >
              {testResult.ok
                ? "All checks passed"
                : `${testResult.checks.filter((c) => !c.ok).length} check(s) failed`}
            </p>
            <ul className="space-y-0.5">
              {testResult.checks.map((c) => (
                <li key={c.name} className="flex items-start gap-1.5">
                  {c.ok ? (
                    <CheckCircleIcon className="h-3.5 w-3.5 mt-px text-emerald-600 shrink-0" />
                  ) : (
                    <ExclamationTriangleIcon className="h-3.5 w-3.5 mt-px text-rose-600 shrink-0" />
                  )}
                  <span className="font-mono text-[11px] text-slate-600">
                    {c.name}:
                  </span>
                  <span
                    className={c.ok ? "text-slate-700" : "text-rose-800"}
                  >
                    {c.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={runTest}
            disabled={testing || saving || busy}
            className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50"
          >
            {testing ? "Testing..." : "Test connection"}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || busy}
            className={`px-3 py-1.5 text-sm font-medium text-white rounded-md disabled:opacity-50 ${
              isProd
                ? "bg-rose-600 hover:bg-rose-700"
                : "bg-indigo-600 hover:bg-indigo-700"
            }`}
          >
            {saving ? "Saving..." : `Save ${isProd ? "Production" : "Sandbox"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function SecretField({
  label,
  placeholder,
  masked,
  isSet,
  envFallback,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  masked: string;
  isSet: boolean;
  envFallback: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1">
        {label}
      </label>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={isSet ? `Stored (${masked}) — type to replace` : placeholder}
        autoComplete="new-password"
        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      {!isSet && envFallback && (
        <p className="text-[11px] text-slate-500 mt-1">
          Currently using env-var fallback. Save a value here to override.
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </div>
  );
}
