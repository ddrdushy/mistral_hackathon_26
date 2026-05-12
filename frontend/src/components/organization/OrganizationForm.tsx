"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPut } from "@/lib/api";
import type { OrganizationProfile } from "@/types/index";

const INDUSTRY_OPTIONS = [
  "Software & Tech",
  "Financial Services",
  "Healthcare",
  "E-commerce & Retail",
  "Manufacturing",
  "Education",
  "Media & Entertainment",
  "Government / Public Sector",
  "Non-profit",
  "Consulting",
  "Construction & Real Estate",
  "Logistics & Transportation",
  "Hospitality",
  "Energy & Utilities",
  "Other",
];

const COMPANY_SIZE_OPTIONS = [
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "501-1000",
  "1001-5000",
  "5000+",
];

const WORK_MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "Onsite" },
];

const CURRENCY_OPTIONS = ["USD", "MYR", "EUR", "GBP", "SGD", "INR", "AUD", "CAD"];

interface Props {
  /** Where to send the user after a successful save. */
  onSaved?: (org: OrganizationProfile) => void;
  /** Hides the heading + description when embedded in a fuller page. */
  compact?: boolean;
}

export default function OrganizationForm({ onSaved, compact = false }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<OrganizationProfile>>({
    name: "",
    industry: "",
    headquarters: "",
    company_size: "",
    website: "",
    about: "",
    default_work_mode: "hybrid",
    default_currency: "USD",
  });

  useEffect(() => {
    (async () => {
      try {
        const org = await apiGet<OrganizationProfile>("/team/organization");
        setForm({
          name: org.name || "",
          industry: org.industry || "",
          headquarters: org.headquarters || "",
          company_size: org.company_size || "",
          website: org.website || "",
          about: org.about || "",
          default_work_mode: org.default_work_mode || "hybrid",
          default_currency: org.default_currency || "USD",
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const update = <K extends keyof OrganizationProfile>(
    key: K,
    value: OrganizationProfile[K] | string,
  ) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const saved = await apiPut<OrganizationProfile>("/team/organization", form);
      setSavedAt(Date.now());
      onSaved?.(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {!compact && (
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Organization profile</h2>
          <p className="text-sm text-slate-600 mt-1">
            These details ground our AI features (job-description generator,
            outreach copy, etc.) in your real company instead of made-up
            placeholders.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Company name" required>
          <input
            type="text"
            required
            value={form.name ?? ""}
            onChange={(e) => update("name", e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Acme Corp"
          />
        </Field>

        <Field label="Industry" required>
          <select
            required
            value={form.industry ?? ""}
            onChange={(e) => update("industry", e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          >
            <option value="">Select industry…</option>
            {INDUSTRY_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </Field>

        <Field
          label="Headquarters / primary location"
          required
          hint="City, Country — used as the default location on new jobs."
        >
          <input
            type="text"
            required
            value={form.headquarters ?? ""}
            onChange={(e) => update("headquarters", e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Kuala Lumpur, Malaysia"
          />
        </Field>

        <Field label="Company size">
          <select
            value={form.company_size ?? ""}
            onChange={(e) => update("company_size", e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          >
            <option value="">Select size…</option>
            {COMPANY_SIZE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt} employees</option>
            ))}
          </select>
        </Field>

        <Field label="Default work mode" hint="Used on AI-generated job posts.">
          <select
            value={form.default_work_mode ?? ""}
            onChange={(e) => update("default_work_mode", e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          >
            {WORK_MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Default salary currency">
          <select
            value={form.default_currency ?? ""}
            onChange={(e) => update("default_currency", e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          >
            {CURRENCY_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </Field>

        <Field label="Website">
          <input
            type="url"
            value={form.website ?? ""}
            onChange={(e) => update("website", e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="https://acme.com"
          />
        </Field>
      </div>

      <Field
        label="About the company"
        hint="One or two sentences. The AI will weave this into job descriptions and outreach."
      >
        <textarea
          value={form.about ?? ""}
          onChange={(e) => update("about", e.target.value)}
          rows={3}
          maxLength={500}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Acme builds AI tooling for HR teams in Southeast Asia. We're remote-first, ~40 people."
        />
      </Field>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save organization profile"}
        </button>
        {savedAt && (
          <span className="text-xs text-emerald-700 font-medium">
            Saved.
          </span>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}
