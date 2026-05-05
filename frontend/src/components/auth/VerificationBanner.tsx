"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth/AuthGate";
import { apiPost } from "@/lib/api";

export default function VerificationBanner() {
  const { me, refresh } = useAuth();
  const [resending, setResending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (!me) return null;
  if (me.user.email_verified) return null;
  if (me.user.is_superadmin) return null;
  if (dismissed) return null;

  const handleResend = async () => {
    setResending(true);
    setNote(null);
    try {
      const res = await apiPost<{ ok: boolean; already_verified?: boolean }>(
        "/auth/resend-verification"
      );
      if (res.already_verified) {
        await refresh();
        setNote("Already verified — refreshing your session.");
      } else {
        setNote("Verification email re-sent. Check your inbox.");
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not resend email");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
      <svg
        className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z" />
      </svg>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-amber-900">
          Verify your email to unlock everything
        </div>
        <div className="text-sm text-amber-800 mt-0.5">
          We sent a verification link to{" "}
          <span className="font-medium">{me.user.email}</span>. Until you confirm it, some
          actions (sending interview emails, billing) will stay disabled.
        </div>
        {note && (
          <div className="text-xs text-amber-700 mt-1.5 font-medium">{note}</div>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={handleResend}
          disabled={resending}
          className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-md text-amber-900 bg-amber-100 hover:bg-amber-200 disabled:opacity-50 transition-colors"
        >
          {resending ? "Sending…" : "Resend email"}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="p-1.5 rounded-md text-amber-700 hover:text-amber-900 hover:bg-amber-100 transition-colors"
          aria-label="Dismiss"
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
