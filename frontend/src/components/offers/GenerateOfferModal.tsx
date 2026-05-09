"use client";

import { useEffect, useState } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { apiGet, apiPost } from "@/lib/api";

interface OfferTemplate {
  id: number;
  name: string;
  body_markdown: string;
  fields: { key: string; label: string; type: string; required?: boolean }[];
  is_default: boolean;
}

const EMPLOYMENT_TYPES = [
  { id: "full_time", label: "Full-time" },
  { id: "part_time", label: "Part-time" },
  { id: "contract", label: "Contract" },
  { id: "intern", label: "Intern" },
];

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "SGD", "AED"];

export default function GenerateOfferModal({
  open,
  onClose,
  onCreated,
  applicationId,
  candidateName,
  jobTitle,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  applicationId: number;
  candidateName: string;
  jobTitle: string;
  candidateEmail: string;
}) {
  const [templates, setTemplates] = useState<OfferTemplate[]>([]);
  const [templateId, setTemplateId] = useState<number | "blank">("blank");
  const [salaryAmount, setSalaryAmount] = useState<string>("");
  const [salaryCurrency, setSalaryCurrency] = useState("USD");
  const [bonusAmount, setBonusAmount] = useState("");
  const [equity, setEquity] = useState("");
  const [employmentType, setEmploymentType] = useState("full_time");
  const [startDate, setStartDate] = useState("");
  const [location, setLocation] = useState("");
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    (async () => {
      try {
        const res = await apiGet<{ templates: OfferTemplate[] }>(
          "/offer-templates",
        );
        if (cancel) return;
        setTemplates(res.templates ?? []);
        const def = res.templates.find((t) => t.is_default);
        if (def) setTemplateId(def.id);
      } catch {
        setTemplates([]);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [open]);

  const selectedTemplate =
    templateId !== "blank" ? templates.find((t) => t.id === templateId) : null;

  if (!open) return null;

  const submit = async () => {
    try {
      setBusy(true);
      setError(null);
      const body: Record<string, unknown> = {
        template_id: templateId === "blank" ? null : templateId,
        salary_amount: salaryAmount ? Number(salaryAmount) : null,
        salary_currency: salaryCurrency,
        bonus_amount: bonusAmount ? Number(bonusAmount) : null,
        equity_description: equity,
        employment_type: employmentType,
        start_date: startDate ? new Date(startDate).toISOString() : null,
        location,
        custom_fields: customFields,
      };
      await apiPost(`/applications/${applicationId}/offers`, body);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Generate offer
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              For <strong>{candidateName}</strong> ·{" "}
              <span className="text-slate-700">{jobTitle}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
              Template
            </label>
            <select
              value={templateId === "blank" ? "blank" : String(templateId)}
              onChange={(e) =>
                setTemplateId(
                  e.target.value === "blank" ? "blank" : Number(e.target.value),
                )
              }
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="blank">Default offer letter</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.is_default ? " (default)" : ""}
                </option>
              ))}
            </select>
            {templates.length === 0 && (
              <p className="text-xs text-slate-500 mt-1">
                No custom templates yet.{" "}
                <a
                  href="/settings/offer-templates"
                  className="text-indigo-600 hover:underline"
                >
                  Create one
                </a>
                .
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                Base salary
              </label>
              <div className="flex gap-2">
                <select
                  value={salaryCurrency}
                  onChange={(e) => setSalaryCurrency(e.target.value)}
                  className="px-2 py-2 text-sm border border-slate-300 rounded-md w-24"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  value={salaryAmount}
                  onChange={(e) => setSalaryAmount(e.target.value)}
                  placeholder="120000"
                  className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                Bonus
              </label>
              <input
                type="number"
                value={bonusAmount}
                onChange={(e) => setBonusAmount(e.target.value)}
                placeholder="optional"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                Start date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                Employment type
              </label>
              <select
                value={employmentType}
                onChange={(e) => setEmploymentType(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              >
                {EMPLOYMENT_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                Location
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Remote · NYC HQ"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                Equity
              </label>
              <input
                type="text"
                value={equity}
                onChange={(e) => setEquity(e.target.value)}
                placeholder="e.g. 0.05% RSUs vesting over 4 years"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
          </div>

          {selectedTemplate && selectedTemplate.fields.length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                Template-specific fields
              </p>
              <div className="grid grid-cols-2 gap-3">
                {selectedTemplate.fields.map((f) => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      {f.label}
                      {f.required ? " *" : ""}
                    </label>
                    <input
                      type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                      value={customFields[f.key] || ""}
                      onChange={(e) =>
                        setCustomFields((cur) => ({
                          ...cur,
                          [f.key]: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-md"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="px-4 py-1.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-50"
          >
            {busy ? "Creating..." : "Create draft"}
          </button>
        </div>
      </div>
    </div>
  );
}
