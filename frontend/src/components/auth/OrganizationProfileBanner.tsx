"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/AuthGate";
import { BuildingOffice2Icon } from "@heroicons/react/24/outline";

/**
 * Nudge banner that surfaces on every dashboard page while the org
 * profile is incomplete. Disappears automatically once industry +
 * headquarters are saved. Hidden on /onboarding and /settings/organization
 * so we don't double-prompt while the user is actively filling the form.
 *
 * Owners only — invited members can't edit org settings, so showing them
 * the banner just creates noise.
 */
export default function OrganizationProfileBanner() {
  const { me } = useAuth();
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);

  if (!me) return null;
  if (me.tenant.profile_completed) return null;
  if (me.user.role !== "owner") return null;
  if (me.user.is_superadmin) return null;
  if (dismissed) return null;
  if (pathname.startsWith("/onboarding")) return null;
  if (pathname.startsWith("/settings/organization")) return null;

  return (
    <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 flex items-start gap-3">
      <BuildingOffice2Icon className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-indigo-900">
          Tell us about your organization
        </div>
        <div className="text-sm text-indigo-800 mt-0.5">
          Until you add your industry and headquarters, AI-generated jobs,
          outreach, and reports will use generic placeholders like
          &quot;San Francisco, CA&quot;.
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <Link
          href="/onboarding"
          className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-md text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
        >
          Complete profile
        </Link>
        <button
          onClick={() => setDismissed(true)}
          className="p-1.5 rounded-md text-indigo-700 hover:text-indigo-900 hover:bg-indigo-100 transition-colors"
          aria-label="Dismiss for this session"
          title="Hide for this session"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
