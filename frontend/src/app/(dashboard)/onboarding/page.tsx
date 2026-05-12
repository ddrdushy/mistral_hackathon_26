"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/auth/AuthGate";
import OrganizationForm from "@/components/organization/OrganizationForm";
import { SparklesIcon } from "@heroicons/react/24/outline";

/**
 * One-time onboarding screen shown right after signup. Captures the
 * organization profile so AI features (JD generator, outreach, etc.) ground
 * prompts on real company data. The user can also skip and fill it in later
 * from /settings/organization — but the dashboard banner will keep nudging
 * them until they do.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const { me, refresh } = useAuth();

  // If profile is already complete, send the user to the dashboard.
  useEffect(() => {
    if (me?.tenant?.profile_completed) {
      router.replace("/dashboard");
    }
  }, [me, router]);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8 text-center">
        <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-100 text-indigo-600 mb-3">
          <SparklesIcon className="w-6 h-6" />
        </span>
        <h1 className="text-2xl font-bold text-slate-900">
          Welcome to HireOps AI{me?.user?.name ? `, ${me.user.name.split(" ")[0]}` : ""}
        </h1>
        <p className="text-sm text-slate-600 mt-2 max-w-lg mx-auto">
          One quick step — tell us about your organization so the AI doesn&apos;t
          invent locations, currencies, or made-up company details when it
          drafts your job posts and outreach.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-sm">
        <OrganizationForm
          compact
          onSaved={async (org) => {
            // Refresh /auth/me so the banner disappears and any
            // profile-gated UI flips on. Then send the user to their
            // brand-new dashboard.
            await refresh();
            if (org.profile_completed) {
              router.push("/dashboard");
            }
          }}
        />
      </div>

      <div className="text-center mt-6">
        <button
          onClick={() => router.push("/dashboard")}
          className="text-sm text-slate-500 hover:text-slate-900"
        >
          Skip for now — I&apos;ll do this later
        </button>
      </div>
    </div>
  );
}
