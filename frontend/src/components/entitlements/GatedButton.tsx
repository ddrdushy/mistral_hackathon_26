"use client";

/**
 * Drop-in button that gates a feature behind an agent name.
 *
 * Allowed → renders children + original onClick.
 * Locked  → renders the same children but greyed, click opens an
 *           inline "Contact us to enable" tooltip with a mailto link.
 *
 * Always renders synchronously off useGate's cached state; while
 * entitlements are still loading we treat the feature as allowed to
 * avoid a flicker.
 */

import { useState, type ReactNode } from "react";
import { useGate } from "./EntitlementsProvider";

interface GatedButtonProps {
  agent: string;
  /** Optional human label shown in the tooltip (e.g. "Voice screening"). */
  featureLabel?: string;
  /** The button's normal classes. Locked state appends grayscale + cursor-not-allowed. */
  className?: string;
  /** Original click handler — only fires when the feature is allowed. */
  onClick?: () => void;
  /** Render as <button type="..."> — defaults to "button". */
  type?: "button" | "submit";
  /** Disable for a non-plan reason (e.g. quota reached) — disabled overrides allowed. */
  disabled?: boolean;
  /** Pass-through title for the allowed state. */
  title?: string;
  children: ReactNode;
}

export default function GatedButton({
  agent,
  featureLabel,
  className = "",
  onClick,
  type = "button",
  disabled,
  title,
  children,
}: GatedButtonProps) {
  const { allowed, contactHref, planLabel } = useGate(agent);
  const [open, setOpen] = useState(false);

  if (allowed) {
    return (
      <button
        type={type}
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={className}
      >
        {children}
      </button>
    );
  }

  const lockedLabel = featureLabel || agent.replace(/_/g, " ");
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${className} opacity-50 cursor-not-allowed filter grayscale`}
        title={`${lockedLabel} isn't included on ${planLabel}. Click to contact us about enabling it.`}
        aria-disabled
      >
        {children}{" "}
        <span className="ml-1 text-[10px] uppercase tracking-wider font-bold align-middle">
          🔒
        </span>
      </button>
      {open && (
        <span
          className="absolute z-50 top-full right-0 mt-2 w-72 rounded-lg bg-slate-900 text-white shadow-xl p-3 text-xs leading-relaxed"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="block font-semibold mb-1">
            {lockedLabel} isn&apos;t enabled on {planLabel}
          </span>
          <span className="block text-slate-300 mb-2">
            Reach out and we&apos;ll turn it on for your tenant.
          </span>
          <a
            href={contactHref}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white text-slate-900 font-semibold text-[11px] hover:bg-slate-100"
            onClick={() => setOpen(false)}
          >
            Contact us →
          </a>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-2 text-slate-400 hover:text-white text-[11px]"
          >
            Dismiss
          </button>
        </span>
      )}
    </span>
  );
}
