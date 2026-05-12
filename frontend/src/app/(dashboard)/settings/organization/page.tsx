"use client";

import Link from "next/link";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import OrganizationForm from "@/components/organization/OrganizationForm";
import { useAuth } from "@/components/auth/AuthGate";

/**
 * Settings → Organization. Same form as /onboarding, accessible after the
 * fact so owners can update industry, HQ, currency, etc. as the company
 * grows. Wraps OrganizationForm with the dashboard chrome.
 */
export default function OrganizationSettingsPage() {
  const { refresh } = useAuth();

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Back to settings
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">
          Organization profile
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          The AI uses these fields to ground job descriptions, outreach
          messages, and reports in your real company instead of generic
          placeholders.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-sm">
        <OrganizationForm
          compact
          onSaved={() => {
            refresh();
          }}
        />
      </div>
    </div>
  );
}
