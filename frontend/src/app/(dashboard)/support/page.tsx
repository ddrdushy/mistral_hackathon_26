"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  ChatBubbleLeftRightIcon,
  TicketIcon,
  StarIcon,
  PaperAirplaneIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { apiGet, apiPost } from "@/lib/api";

type Tab = "tickets" | "feedback";

interface Ticket {
  id: number;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  admin_reply: string;
  admin_replied_at: string | null;
  created_at: string;
  updated_at: string;
  created_by_email: string | null;
}

const STATUS_TONE: Record<string, string> = {
  open: "bg-blue-50 text-blue-700 border-blue-200",
  in_progress: "bg-indigo-50 text-indigo-700 border-indigo-200",
  waiting_tenant: "bg-amber-50 text-amber-700 border-amber-200",
  resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  closed: "bg-slate-100 text-slate-600 border-slate-200",
};

const PRIORITY_TONE: Record<string, string> = {
  low: "bg-slate-50 text-slate-600",
  normal: "bg-slate-50 text-slate-600",
  high: "bg-amber-50 text-amber-700",
  urgent: "bg-rose-50 text-rose-700",
};

export default function SupportPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <SupportInner />
    </Suspense>
  );
}

function SupportInner() {
  // Pre-fill from URL params so deep-links from 'Coming soon' provider
  // cards land directly in the New-ticket composer with helpful context.
  // Recognized params: ?compose=1 &subject=... &category=... &priority=...
  //                    &message=... (for feedback tab)
  const params = useSearchParams();
  const initialTab: Tab = params.get("tab") === "feedback" ? "feedback" : "tickets";
  const [tab, setTab] = useState<Tab>(initialTab);

  const prefill = {
    compose: params.get("compose") === "1",
    subject: params.get("subject") || "",
    category: params.get("category") || "",
    priority: params.get("priority") || "",
    description: params.get("description") || "",
    message: params.get("message") || "",
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Help & support</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          File a ticket or send the team a note. We read every message.
        </p>
      </div>

      <div className="border-b border-slate-200 flex gap-1">
        <TabButton active={tab === "tickets"} onClick={() => setTab("tickets")}>
          <TicketIcon className="w-4 h-4" /> Support tickets
        </TabButton>
        <TabButton active={tab === "feedback"} onClick={() => setTab("feedback")}>
          <ChatBubbleLeftRightIcon className="w-4 h-4" /> Send feedback
        </TabButton>
      </div>

      {tab === "tickets" ? (
        <TicketsTab prefill={prefill} />
      ) : (
        <FeedbackTab prefillMessage={prefill.message} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-2 -mb-px text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-indigo-600 text-indigo-700"
          : "border-transparent text-slate-500 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

// ── Tickets tab ──────────────────────────────────────────────────────────────

interface TicketPrefill {
  compose: boolean;
  subject: string;
  category: string;
  priority: string;
  description: string;
}

function TicketsTab({ prefill }: { prefill: TicketPrefill }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(prefill.compose);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ tickets: Ticket[] }>("/support/tickets");
      setTickets(res.tickets || []);
    } catch {
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          {loading
            ? "Loading…"
            : tickets.length === 0
            ? "No tickets yet."
            : `${tickets.length} ticket${tickets.length === 1 ? "" : "s"}`}
        </p>
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
        >
          <TicketIcon className="w-4 h-4" /> New ticket
        </button>
      </div>

      {composing && (
        <TicketComposer
          initial={prefill.compose ? prefill : undefined}
          onCancel={() => setComposing(false)}
          onCreated={() => {
            setComposing(false);
            load();
          }}
        />
      )}

      <div className="space-y-2">
        {tickets.map((t) => (
          <TicketCard key={t.id} ticket={t} />
        ))}
      </div>
    </div>
  );
}

function TicketCard({ ticket }: { ticket: Ticket }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-left w-full"
          >
            <p className="text-sm font-semibold text-slate-900 truncate">
              {ticket.subject}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              #{ticket.id} ·{" "}
              {new Date(ticket.created_at).toLocaleString()} ·{" "}
              {ticket.created_by_email || "you"}
            </p>
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${PRIORITY_TONE[ticket.priority] || PRIORITY_TONE.normal}`}
          >
            {ticket.priority}
          </span>
          <span
            className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border ${STATUS_TONE[ticket.status] || STATUS_TONE.open}`}
          >
            {ticket.status.replace("_", " ")}
          </span>
        </div>
      </div>
      {open && (
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
          <p className="text-sm text-slate-700 whitespace-pre-wrap">
            {ticket.description}
          </p>
          {ticket.admin_reply && (
            <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-700">
                Reply from support
              </p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap mt-1">
                {ticket.admin_reply}
              </p>
              {ticket.admin_replied_at && (
                <p className="text-[11px] text-slate-500 mt-1">
                  {new Date(ticket.admin_replied_at).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TicketComposer({
  initial,
  onCancel,
  onCreated,
}: {
  initial?: {
    subject?: string;
    description?: string;
    category?: string;
    priority?: string;
  };
  onCancel: () => void;
  onCreated: () => void;
}) {
  const validCategory = (c?: string) =>
    c && ["bug", "feature_request", "billing", "other"].includes(c) ? c : "bug";
  const validPriority = (p?: string) =>
    p && ["low", "normal", "high", "urgent"].includes(p) ? p : "normal";

  const [subject, setSubject] = useState(initial?.subject || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [category, setCategory] = useState(validCategory(initial?.category));
  const [priority, setPriority] = useState(validPriority(initial?.priority));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (subject.trim().length < 3) {
      setError("Subject must be at least 3 characters.");
      return;
    }
    if (description.trim().length < 10) {
      setError("Please describe the issue in at least 10 characters.");
      return;
    }
    setSubmitting(true);
    try {
      await apiPost("/support/tickets", {
        subject: subject.trim(),
        description: description.trim(),
        category,
        priority,
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
    >
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Subject
        </label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Short summary of the issue"
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          autoFocus
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Category
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="bug">Bug</option>
            <option value="feature_request">Feature request</option>
            <option value="billing">Billing</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Priority
          </label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={6}
          placeholder="What happened, what did you expect, and any steps to reproduce. Avoid pasting candidate-private data unless directly relevant."
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {error && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1 flex items-center gap-1">
          <ExclamationTriangleIcon className="h-3.5 w-3.5" />
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-md"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
        >
          <PaperAirplaneIcon className="w-4 h-4" />
          {submitting ? "Submitting…" : "Submit ticket"}
        </button>
      </div>
    </form>
  );
}

// ── Feedback tab ─────────────────────────────────────────────────────────────

function FeedbackTab({ prefillMessage = "" }: { prefillMessage?: string }) {
  const [rating, setRating] = useState<number | null>(null);
  const [category, setCategory] = useState("suggestion");
  const [message, setMessage] = useState(prefillMessage);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (message.trim().length < 3) {
      setError("Please share at least 3 characters.");
      return;
    }
    setSubmitting(true);
    try {
      await apiPost("/feedback", {
        rating,
        rating_scale: "csat",
        category,
        message: message.trim(),
      });
      setSuccess(true);
      setMessage("");
      setRating(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="bg-white border border-slate-200 rounded-xl p-4 space-y-4 max-w-2xl"
    >
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1.5">
          How are we doing? (optional)
        </label>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              type="button"
              key={n}
              onClick={() => setRating(rating === n ? null : n)}
              className={`p-1.5 rounded-md transition-colors ${
                rating !== null && n <= rating
                  ? "text-amber-500"
                  : "text-slate-300 hover:text-slate-500"
              }`}
              aria-label={`Rate ${n} out of 5`}
            >
              <StarIcon className="w-6 h-6 fill-current" />
            </button>
          ))}
          {rating !== null && (
            <button
              type="button"
              onClick={() => setRating(null)}
              className="ml-2 text-xs text-slate-500 hover:text-slate-900"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Type
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full sm:w-60 px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="praise">Praise</option>
          <option value="suggestion">Suggestion</option>
          <option value="bug">Something feels off</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Your message
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          placeholder="Tell us what's working, what's not, or what you'd love to see next."
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {success && (
        <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 flex items-center gap-1">
          <CheckCircleIcon className="w-3.5 h-3.5" />
          Thanks — we read every piece of feedback.
        </p>
      )}
      {error && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1 flex items-center gap-1">
          <ExclamationTriangleIcon className="w-3.5 h-3.5" />
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
        >
          <PaperAirplaneIcon className="w-4 h-4" />
          {submitting ? "Sending…" : "Send feedback"}
        </button>
      </div>
    </form>
  );
}
