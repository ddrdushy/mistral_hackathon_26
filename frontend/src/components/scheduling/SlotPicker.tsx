"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarIcon,
  ClipboardDocumentIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { apiGet } from "@/lib/api";

interface Slot {
  start: string;
  end: string;
  day_of_week: string;
  label: string;
}

interface SlotsResponse {
  duration_minutes: number;
  days_ahead: number;
  calendar_connected: boolean;
  calendar_email: string | null;
  busy_intervals: { start: string; end: string }[];
  slots: Slot[];
}

/**
 * Picker for interview times. Pulls /calendar/slots which already
 * filters against the recruiter's Google Calendar busy/free if connected.
 * If the recruiter hasn't connected a calendar, the endpoint returns
 * plain business-hour suggestions (no clash detection) and we surface
 * a soft callout pointing to /settings/calendar.
 */
export default function SlotPicker({
  durationMinutes = 30,
  daysAhead = 5,
}: {
  durationMinutes?: number;
  daysAhead?: number;
}) {
  const [data, setData] = useState<SlotsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<SlotsResponse>(
        `/calendar/slots?duration_minutes=${durationMinutes}&days_ahead=${daysAhead}`,
      );
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load slots");
    } finally {
      setLoading(false);
    }
  }, [durationMinutes, daysAhead]);

  useEffect(() => {
    load();
  }, [load]);

  const copy = async (idx: number, label: string) => {
    try {
      await navigator.clipboard.writeText(label);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-start gap-2">
          <CalendarIcon className="w-5 h-5 text-indigo-600 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Suggested interview times
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {data?.calendar_connected
                ? `Filtered against ${data.calendar_email}'s Google Calendar.`
                : "Business-hour windows. Connect your calendar for clash-free suggestions."}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100"
        >
          <ArrowPathIcon className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {!data?.calendar_connected && data?.configured !== false && !loading && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <Link
            href="/settings/calendar"
            className="font-semibold text-amber-900 hover:underline"
          >
            Connect Google Calendar
          </Link>{" "}
          to filter out times you&apos;re already booked.
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-9 bg-slate-100 rounded animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      ) : !data || data.slots.length === 0 ? (
        <p className="text-sm text-slate-500">
          No slots available in the next {daysAhead} business days.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.slots.map((slot, i) => (
            <li
              key={slot.start}
              className="py-2 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-800">
                  {slot.label}
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  {slot.start} → {slot.end}
                </div>
              </div>
              <button
                type="button"
                onClick={() => copy(i, slot.label)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
              >
                <ClipboardDocumentIcon className="w-3.5 h-3.5" />
                {copiedIdx === i ? "Copied" : "Copy"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
