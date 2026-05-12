"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BellIcon } from "@heroicons/react/24/outline";
import { apiGet } from "@/lib/api";
import { timeAgo } from "@/lib/constants";

interface Notification {
  id: string;
  kind: string;
  event_type: string;
  message: string;
  app_id: number | null;
  candidate_name: string;
  job_title: string | null;
  href: string | null;
  created_at: string | null;
}

const LAST_SEEN_KEY = "hireops.notifications.last_seen_at";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastSeen, setLastSeen] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(LAST_SEEN_KEY) || "";
  });
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ notifications: Notification[] }>(
        "/notifications?limit=20",
      );
      setItems(res.notifications || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll every 60s so the unread dot keeps up with new events without
  // a websocket. Cheap query — bounded by surfaced event types.
  useEffect(() => {
    load();
    const i = setInterval(load, 60_000);
    return () => clearInterval(i);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const unreadCount = items.filter(
    (n) => n.created_at && (!lastSeen || n.created_at > lastSeen),
  ).length;

  const handleOpen = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next && items.length > 0) {
        // Mark everything currently visible as read.
        const newest = items[0]?.created_at || new Date().toISOString();
        setLastSeen(newest);
        try {
          window.localStorage.setItem(LAST_SEEN_KEY, newest);
        } catch {
          /* ignore quota */
        }
      }
      return next;
    });
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={handleOpen}
        className="relative p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
        aria-label={`Notifications (${unreadCount} unread)`}
      >
        <BellIcon className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-600 rounded-full" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900">
              Notifications
            </span>
            {unreadCount > 0 && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-semibold">
                {unreadCount} new
              </span>
            )}
          </div>
          {loading ? (
            <div className="px-4 py-3 text-xs text-slate-500">Loading…</div>
          ) : items.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-500">
              You&apos;re all caught up.
              <div className="text-[11px] text-slate-400 mt-1">
                Activity from interviews, matches, and WhatsApp replies will appear here.
              </div>
            </div>
          ) : (
            <ul className="max-h-96 overflow-y-auto divide-y divide-slate-100">
              {items.map((n) => {
                const isUnread =
                  n.created_at && (!lastSeen || n.created_at > lastSeen);
                const row = (
                  <div
                    className={`px-3 py-2.5 flex items-start gap-3 ${
                      isUnread ? "bg-indigo-50/30" : ""
                    } hover:bg-slate-50`}
                  >
                    <span
                      className={`mt-1.5 inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        isUnread ? "bg-indigo-500" : "bg-transparent"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-slate-800 leading-snug">
                        {n.message}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {n.created_at ? timeAgo(n.created_at) : ""}
                      </div>
                    </div>
                  </div>
                );
                return (
                  <li key={n.id}>
                    {n.href ? (
                      <Link href={n.href} onClick={() => setOpen(false)}>
                        {row}
                      </Link>
                    ) : (
                      row
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
