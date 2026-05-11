"use client";

import { useEffect } from "react";
import Link from "next/link";
import {
  XMarkIcon,
  QuestionMarkCircleIcon,
  CheckCircleIcon,
  CogIcon,
  LightBulbIcon,
  ArrowTopRightOnSquareIcon,
  ShieldCheckIcon,
  StarIcon,
} from "@heroicons/react/24/outline";
import type { HelpEntry, HelpStep, HelpLink } from "@/lib/help/types";

interface HelpDrawerProps {
  open: boolean;
  onClose: () => void;
  entry: HelpEntry;
}

export default function HelpDrawer({ open, onClose, entry }: HelpDrawerProps) {
  // Close on Esc
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close help"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/30 backdrop-blur-[1px]"
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-labelledby="help-drawer-title"
        className="absolute right-0 top-0 h-full w-full sm:w-[420px] bg-white shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200 sticky top-0 bg-white">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600 flex items-center gap-1">
              <QuestionMarkCircleIcon className="w-3.5 h-3.5" /> Help
            </p>
            <h2
              id="help-drawer-title"
              className="text-lg font-bold text-slate-900 mt-0.5"
            >
              {entry.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {entry.superAdminOnly && (
            <RoleBadge
              icon={<ShieldCheckIcon className="w-4 h-4" />}
              label="Super-admin only"
              tone="rose"
            />
          )}
          {entry.ownerOnly && !entry.superAdminOnly && (
            <RoleBadge
              icon={<StarIcon className="w-4 h-4" />}
              label="Tenant owner action"
              tone="amber"
            />
          )}

          {/* What */}
          <Section title="What is this?">
            <p className="text-sm text-slate-700 leading-relaxed">{entry.what}</p>
            {entry.highlights && entry.highlights.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {entry.highlights.map((h, i) => (
                  <li
                    key={i}
                    className="text-sm text-slate-600 flex items-start gap-2"
                  >
                    <span className="text-indigo-500 mt-0.5">•</span>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* How to use */}
          <Section
            title="How to use it"
            icon={<CheckCircleIcon className="w-4 h-4 text-emerald-500" />}
          >
            <StepList steps={entry.howToUse} />
          </Section>

          {/* How to configure */}
          {entry.howToConfigure && entry.howToConfigure.length > 0 && (
            <Section
              title="How to configure"
              icon={<CogIcon className="w-4 h-4 text-slate-500" />}
            >
              <StepList steps={entry.howToConfigure} />
            </Section>
          )}

          {/* Tips */}
          {entry.tips && entry.tips.length > 0 && (
            <Section
              title="Tips"
              icon={<LightBulbIcon className="w-4 h-4 text-amber-500" />}
            >
              <ul className="space-y-1.5">
                {entry.tips.map((t, i) => (
                  <li
                    key={i}
                    className="text-sm text-slate-600 leading-relaxed flex items-start gap-2"
                  >
                    <span className="text-amber-500 mt-0.5">•</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Learn more */}
          {entry.learnMore && entry.learnMore.length > 0 && (
            <Section title="Related">
              <div className="flex flex-col gap-1.5">
                {entry.learnMore.map((l, i) => (
                  <LearnMoreLink key={i} link={l} onClose={onClose} />
                ))}
              </div>
            </Section>
          )}

          <div className="border-t border-slate-100 pt-4">
            <Link
              href="/support"
              onClick={onClose}
              className="block rounded-lg bg-indigo-50 hover:bg-indigo-100 transition-colors px-3 py-2.5 text-sm text-indigo-700"
            >
              <span className="font-semibold">Still stuck?</span> Open a support
              ticket — we read every message.
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function StepList({ steps }: { steps: HelpStep[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-[11px] font-bold flex items-center justify-center mt-0.5">
            {i + 1}
          </span>
          <div className="min-w-0">
            <p className="text-sm text-slate-700 leading-snug">{s.text}</p>
            {s.detail && (
              <p className="text-xs text-slate-500 leading-snug mt-0.5">
                {s.detail}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function LearnMoreLink({
  link,
  onClose,
}: {
  link: HelpLink;
  onClose: () => void;
}) {
  if (link.kind === "external" || link.href.startsWith("http")) {
    return (
      <a
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800 hover:underline"
      >
        {link.label}
        <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
      </a>
    );
  }
  return (
    <Link
      href={link.href}
      onClick={onClose}
      className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800 hover:underline"
    >
      {link.label} →
    </Link>
  );
}

function RoleBadge({
  icon,
  label,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  tone: "amber" | "rose";
}) {
  const cls =
    tone === "rose"
      ? "bg-rose-50 text-rose-700 border-rose-200"
      : "bg-amber-50 text-amber-700 border-amber-200";
  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold border ${cls}`}
    >
      {icon}
      {label}
    </div>
  );
}
