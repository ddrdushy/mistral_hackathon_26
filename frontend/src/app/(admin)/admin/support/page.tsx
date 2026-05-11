"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  TicketIcon,
  ChatBubbleLeftRightIcon,
  StarIcon,
  PaperAirplaneIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { apiGet, apiPatch } from "@/lib/api";

type Tab = "tickets" | "feedback";

interface AdminTicket {
  id: number;
  tenant_id: number;
  tenant_name: string | null;
  tenant_plan: string | null;
  created_by_email: string | null;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  admin_reply: string;
  admin_replied_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AdminFeedback {
  id: number;
  tenant_id: number;
  tenant_name: string | null;
  tenant_plan: string | null;
  created_by_email: string | null;
  rating: number | null;
  rating_scale: string;
  category: string;
  message: string;
  reviewed_at: string | null;
  created_at: string;
}

interface FeedbackStats {
  total: number;
  csat_count: number;
  csat_avg: number | null;
  nps_count: number;
  nps_avg: number | null;
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

export default function AdminSupportPage() {
  const [tab, setTab] = useState<Tab>("tickets");
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Platform Admin
        </p>
        <h1 className="text-2xl font-bold text-slate-900 mt-0.5">Support & feedback</h1>
        <p className="text-sm text-slate-500 mt-1">
          Triage tenant-raised tickets and read product feedback. Tenants only see
          their own content; you only see what they explicitly typed here.
        </p>
      </div>

      <div className="border-b border-slate-200 flex gap-1">
        <TabButton active={tab === "tickets"} onClick={() => setTab("tickets")}>
          <TicketIcon className="w-4 h-4" /> Tickets
        </TabButton>
        <TabButton active={tab === "feedback"} onClick={() => setTab("feedback")}>
          <ChatBubbleLeftRightIcon className="w-4 h-4" /> Feedback
        </TabButton>
      </div>

      {tab === "tickets" ? <TicketsAdmin /> : <FeedbackAdmin />}
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

// ── Tickets ──────────────────────────────────────────────────────────────────

function TicketsAdmin() {
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [priorityFilter, setPriorityFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      if (priorityFilter) params.priority = priorityFilter;
      const res = await apiGet<{ tickets: AdminTicket[] }>(
        "/admin/support/tickets",
        params,
      );
      setTickets(res.tickets || []);
    } catch {
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, priorityFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-2.5 py-1.5 text-xs rounded-md border border-slate-300 bg-white"
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="waiting_tenant">Waiting on tenant</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="px-2.5 py-1.5 text-xs rounded-md border border-slate-300 bg-white"
        >
          <option value="">All priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
        <p className="text-xs text-slate-500 ml-auto">
          {loading ? "Loading…" : `${tickets.length} ticket${tickets.length === 1 ? "" : "s"}`}
        </p>
      </div>

      <div className="space-y-2">
        {tickets.map((t) => (
          <AdminTicketCard
            key={t.id}
            ticket={t}
            expanded={expandedId === t.id}
            onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
            onUpdated={load}
          />
        ))}
      </div>
    </div>
  );
}

function AdminTicketCard({
  ticket,
  expanded,
  onToggle,
  onUpdated,
}: {
  ticket: AdminTicket;
  expanded: boolean;
  onToggle: () => void;
  onUpdated: () => void;
}) {
  const [reply, setReply] = useState(ticket.admin_reply || "");
  const [newStatus, setNewStatus] = useState(ticket.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      if (newStatus !== ticket.status) payload.status = newStatus;
      if (reply.trim() !== (ticket.admin_reply || "").trim())
        payload.admin_reply = reply.trim();
      if (Object.keys(payload).length === 0) {
        setError("No changes to save");
        return;
      }
      await apiPatch(`/admin/support/tickets/${ticket.id}`, payload);
      onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <button
        type="button"
        onClick={onToggle}
        className="text-left w-full"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">
              {ticket.subject}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              #{ticket.id} ·{" "}
              <Link
                href={`/admin/tenants/${ticket.tenant_id}`}
                className="font-medium hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {ticket.tenant_name || `tenant ${ticket.tenant_id}`}
              </Link>
              {ticket.tenant_plan && ` · ${ticket.tenant_plan}`} ·{" "}
              {ticket.created_by_email} ·{" "}
              {new Date(ticket.created_at).toLocaleString()}
            </p>
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
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Tenant description
            </p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">
              {ticket.description}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1">
                Status
              </label>
              <select
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value)}
                className="w-full px-2 py-1.5 rounded-md border border-slate-300 text-sm bg-white"
              >
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="waiting_tenant">Waiting on tenant</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1">
                Reply to tenant
              </label>
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={3}
                placeholder="The tenant sees this directly on their support page."
                className="w-full px-2 py-1.5 rounded-md border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1 flex items-center gap-1">
              <ExclamationTriangleIcon className="w-3.5 h-3.5" /> {error}
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              <PaperAirplaneIcon className="w-4 h-4" />
              {saving ? "Saving…" : "Update"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Feedback ─────────────────────────────────────────────────────────────────

function FeedbackAdmin() {
  const [items, setItems] = useState<AdminFeedback[]>([]);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (categoryFilter) params.category = categoryFilter;
      const res = await apiGet<{ feedback: AdminFeedback[]; stats: FeedbackStats }>(
        "/admin/feedback",
        params,
      );
      setItems(res.feedback || []);
      setStats(res.stats || null);
    } catch {
      setItems([]);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [categoryFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const markReviewed = async (id: number, reviewed: boolean) => {
    try {
      await apiPatch(`/admin/feedback/${id}`, { reviewed });
      load();
    } catch {
      // swallow — UI will refresh on next manual reload
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total" value={stats ? String(stats.total) : "—"} />
        <StatCard
          label="CSAT avg"
          value={stats?.csat_avg != null ? `${stats.csat_avg} / 5` : "—"}
          hint={stats ? `${stats.csat_count} rated` : ""}
        />
        <StatCard
          label="NPS avg"
          value={stats?.nps_avg != null ? `${stats.nps_avg} / 10` : "—"}
          hint={stats ? `${stats.nps_count} rated` : ""}
        />
        <StatCard
          label="Reviewed"
          value={`${items.filter((i) => i.reviewed_at).length} / ${items.length}`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-2.5 py-1.5 text-xs rounded-md border border-slate-300 bg-white"
        >
          <option value="">All categories</option>
          <option value="praise">Praise</option>
          <option value="suggestion">Suggestion</option>
          <option value="bug">Bug</option>
          <option value="other">Other</option>
        </select>
        <p className="text-xs text-slate-500 ml-auto">
          {loading ? "Loading…" : `${items.length} entries`}
        </p>
      </div>

      <div className="space-y-2">
        {items.map((f) => (
          <div key={f.id} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-500">
                  <Link
                    href={`/admin/tenants/${f.tenant_id}`}
                    className="font-medium hover:underline"
                  >
                    {f.tenant_name || `tenant ${f.tenant_id}`}
                  </Link>
                  {f.tenant_plan && ` · ${f.tenant_plan}`} · {f.created_by_email} ·{" "}
                  {new Date(f.created_at).toLocaleString()}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  {f.rating != null && (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                      <StarIcon className="w-3.5 h-3.5 fill-current" />
                      {f.rating} / {f.rating_scale === "csat" ? 5 : 10}
                    </span>
                  )}
                  <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                    {f.category}
                  </span>
                </div>
                <p className="text-sm text-slate-700 whitespace-pre-wrap mt-2">
                  {f.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => markReviewed(f.id, !f.reviewed_at)}
                className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium ${
                  f.reviewed_at
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {f.reviewed_at ? (
                  <>
                    <CheckCircleIcon className="w-3.5 h-3.5" /> Reviewed
                  </>
                ) : (
                  "Mark reviewed"
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className="text-xl font-bold text-slate-900 mt-1">{value}</p>
      {hint && <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>}
    </div>
  );
}
