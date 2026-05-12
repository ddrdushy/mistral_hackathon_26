"use client";

import { useEffect, useState } from "react";
import {
  QuestionMarkCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useHelp } from "./HelpContext";

const PULSE_DISMISSED_KEY = "hireops.help.pulse-dismissed";

/**
 * Always-visible launcher anchored bottom-right. Triggers the same
 * contextual help drawer the Topbar `?` icon does — the difference
 * is discoverability: this button is large, persistent, and lives in
 * the part of the screen users instinctively scan for in-app support.
 *
 * On first visit we add a soft pulse + a one-line tooltip so the
 * affordance is obvious. After the user opens the drawer once we
 * stop pulsing — stored in localStorage so it doesn't follow them
 * across sessions on the same device.
 */
export default function FloatingHelpButton() {
  const { open, isOpen, entry } = useHelp();
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissed = window.localStorage.getItem(PULSE_DISMISSED_KEY);
    if (!dismissed) setPulse(true);
  }, []);

  const handleClick = () => {
    if (pulse && typeof window !== "undefined") {
      window.localStorage.setItem(PULSE_DISMISSED_KEY, "1");
      setPulse(false);
    }
    open();
  };

  // Don't double-render when the drawer is open — the drawer already
  // covers the area and clicking again would do nothing.
  if (isOpen) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Help for this page: ${entry.title}`}
      title={`Help: ${entry.title}`}
      className="group fixed z-40 bottom-5 right-5 inline-flex items-center gap-2 pl-3.5 pr-4 py-2.5 rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 hover:shadow-xl active:scale-95 transition-all"
    >
      {pulse && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-indigo-500 animate-ping opacity-60"
        />
      )}
      <span className="relative inline-flex items-center gap-2">
        <QuestionMarkCircleIcon className="w-5 h-5" />
        <span className="text-sm font-semibold whitespace-nowrap">Need help?</span>
      </span>
    </button>
  );
}

/**
 * Small variant — same trigger, but renders as a discreet `[?] Need help?`
 * line. Useful inside empty-state cards / coming-soon banners. Caller
 * controls placement; this is just a styled button.
 */
export function HelpInlineLink({ label = "Need help?" }: { label?: string }) {
  const { open } = useHelp();
  return (
    <button
      type="button"
      onClick={() => open()}
      className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
    >
      <QuestionMarkCircleIcon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

// Re-export X icon so nothing else has to know the heroicons path —
// keeps the floating component self-contained for future iterations.
export { XMarkIcon };
