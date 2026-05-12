"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeftIcon,
  CalendarIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";
import { apiGet, apiDelete } from "@/lib/api";

interface CalendarStatus {
  configured: boolean;
  connected: boolean;
  email_address: string | null;
  connected_at: string | null;
  last_refreshed_at: string | null;
  provider: string | null;
}

export default function CalendarSettingsPage() {
  const params = useSearchParams();
  const justConnected = params.get("connected") === "1";

  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<CalendarStatus>("/calendar/me");
      setStatus(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiGet<{ url: string }>("/calendar/google/start");
      window.location.href = res.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start OAuth");
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Disconnect this calendar? Slot suggestions will fall back to plain business hours until you reconnect.")) {
      return;
    }
    setBusy(true);
    try {
      await apiDelete("/calendar/me");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setBusy(false);
    }
  };

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
        <CalendarIcon className="w-6 h-6 text-indigo-600" />
        <h1 className="text-2xl font-bold text-slate-900">Calendar integration</h1>
      </div>
      <p className="text-sm text-slate-600 mb-6">
        Connect your Google Calendar so the system can suggest interview
        times that don&apos;t clash with your existing meetings. Each
        recruiter connects their own calendar; nothing is shared across
        the team.
      </p>

      {justConnected && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 flex items-start gap-2">
          <CheckCircleIcon className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Calendar connected.</div>
            <div className="text-xs text-emerald-700 mt-0.5">
              Interview slot suggestions will now skip times you&apos;re
              already booked.
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        {loading ? (
          <div className="h-20 bg-slate-100 rounded animate-pulse" />
        ) : !status?.configured ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-semibold mb-1">Not configured by the platform</div>
            <div className="text-xs text-amber-800">
              Calendar integration requires{" "}
              <code className="font-mono">GOOGLE_OAUTH_CLIENT_ID</code> and{" "}
              <code className="font-mono">GOOGLE_OAUTH_CLIENT_SECRET</code>{" "}
              to be set in the backend environment. Ask your administrator.
            </div>
          </div>
        ) : status.connected ? (
          <div>
            <div className="flex items-start gap-3">
              <CheckCircleIcon className="w-6 h-6 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-900">
                  Google Calendar connected
                </div>
                <div className="text-xs text-slate-600 mt-0.5">
                  Reading busy/free from{" "}
                  <span className="font-mono">{status.email_address}</span>.
                </div>
                {status.connected_at && (
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Connected {new Date(status.connected_at).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={connect}
                disabled={busy}
                className="inline-flex items-center px-3 py-2 rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-medium disabled:opacity-50"
              >
                Reconnect
              </button>
              <button
                type="button"
                onClick={disconnect}
                disabled={busy}
                className="inline-flex items-center px-3 py-2 rounded-md bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 text-sm font-medium disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm text-slate-700 mb-4">
              You haven&apos;t connected a calendar yet. Slot suggestions
              currently fall back to plain business-hour windows (no clash
              detection).
            </p>
            <button
              type="button"
              onClick={connect}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold disabled:opacity-50"
            >
              {busy ? "Starting…" : "Connect Google Calendar"}
            </button>
            <p className="text-[11px] text-slate-500 mt-3">
              We request <span className="font-mono">calendar.readonly</span>{" "}
              scope — we can see when you&apos;re busy but cannot move or
              create events.
            </p>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
