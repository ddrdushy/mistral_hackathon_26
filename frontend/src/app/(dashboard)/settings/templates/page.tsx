"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeftIcon,
  EnvelopeIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";
import { apiGet } from "@/lib/api";

interface TemplateInfo {
  key: string;
  label: string;
  description: string;
  variables: string[];
  source: "platform_default" | "tenant";
  subject: string;
  body_html: string;
  body_text: string;
  updated_at: string | null;
}

export default function TemplatesIndexPage() {
  const [items, setItems] = useState<TemplateInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<TemplateInfo[]>("/email-templates");
      setItems(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-3xl">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 mb-4"
      >
        <ArrowLeftIcon className="w-4 h-4" />
        Back to settings
      </Link>

      <div className="flex items-center gap-2 mb-2">
        <EnvelopeIcon className="w-6 h-6 text-indigo-600" />
        <h1 className="text-2xl font-bold text-slate-900">Email templates</h1>
      </div>
      <p className="text-sm text-slate-600 mb-6">
        Customise the subject and body of every email the platform sends
        on your behalf. Tenants on this workspace use these templates;
        the platform defaults apply for anything you haven&apos;t overridden.
        Branding (logo / colour / signature) lives on the{" "}
        <Link
          href="/settings/organization"
          className="font-medium text-indigo-700 hover:underline"
        >
          Organization profile
        </Link>
        .
      </p>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-slate-100 rounded animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((t) => (
            <li key={t.key}>
              <Link
                href={`/settings/templates/${t.key}`}
                className="block bg-white rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-sm p-5 transition-all"
              >
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-900">
                        {t.label}
                      </span>
                      <span
                        className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-semibold ${
                          t.source === "tenant"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {t.source === "tenant" ? "Custom" : "Default"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {t.description}
                    </p>
                    <p className="text-xs text-slate-400 mt-2 font-mono truncate">
                      {t.subject}
                    </p>
                  </div>
                  <PencilSquareIcon className="w-4 h-4 text-slate-400 flex-shrink-0 mt-1" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
