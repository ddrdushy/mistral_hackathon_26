"use client";

/**
 * Banner that warns at the top of a page when the underlying agent
 * isn't enabled on the tenant's plan. Pages that use it: /calls,
 * /interviews, /outreach, /reports — anywhere a tenant could land
 * expecting a feature and discover (via API errors) that it's gated.
 *
 * Renders nothing while entitlements are loading or when the agent is
 * already allowed.
 */

import { useGate } from "./EntitlementsProvider";

export default function FeatureLockBanner({
  agent,
  featureLabel,
  description,
}: {
  agent: string;
  featureLabel: string;
  description: string;
}) {
  const { allowed, loading, contactHref, planLabel } = useGate(agent);
  if (loading || allowed) return null;
  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="mt-0.5 inline-flex w-7 h-7 rounded-lg bg-amber-200 text-amber-900 items-center justify-center text-base">
          🔒
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-amber-900">
            {featureLabel} isn&apos;t enabled on {planLabel}
          </h2>
          <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
            {description}
          </p>
        </div>
        <a
          href={contactHref}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-700 text-white text-xs font-semibold hover:bg-amber-800"
        >
          Contact us to enable →
        </a>
      </div>
    </div>
  );
}
