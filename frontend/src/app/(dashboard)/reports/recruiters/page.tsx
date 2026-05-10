"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { apiGet } from "@/lib/api";

interface RecruiterRow {
  user_id: number;
  name: string;
  email: string;
  candidates_added: number;
  applications_progressed: number;
  interviews_evaluated: number;
  offers_extended: number;
  hires_made: number;
  avg_time_to_screen_hours: number | null;
  conversion: { applied_to_screened: number; screened_to_offer: number };
  llm_cost_usd: number;
}

interface SummaryResponse {
  period: { start: string; end: string };
  recruiters: RecruiterRow[];
  first_attributed_event_at: string | null;
}

type SortField = keyof Pick<
  RecruiterRow,
  | "name"
  | "candidates_added"
  | "applications_progressed"
  | "interviews_evaluated"
  | "offers_extended"
  | "hires_made"
  | "avg_time_to_screen_hours"
>;

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n: number) =>
  new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);

export default function RecruitersReportPage() {
  const [start, setStart] = useState(daysAgoIso(30));
  const [end, setEnd] = useState(todayIso());
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>(
    "applications_progressed",
  );
  const [sortDesc, setSortDesc] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiGet<SummaryResponse>(
        `/metrics/recruiters?start=${start}&end=${end}`,
      );
      setData(res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Load failed";
      setError(
        msg.includes("403") || msg.toLowerCase().includes("owner")
          ? "Only the tenant owner can view recruiter metrics."
          : msg,
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  useEffect(() => {
    load();
  }, [load]);

  const sorted = useMemo(() => {
    if (!data) return [];
    const out = [...data.recruiters];
    out.sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (typeof av === "number" && typeof bv === "number") {
        return sortDesc ? bv - av : av - bv;
      }
      const as = String(av ?? "");
      const bs = String(bv ?? "");
      return sortDesc ? bs.localeCompare(as) : as.localeCompare(bs);
    });
    return out;
  }, [data, sortField, sortDesc]);

  const setSort = (f: SortField) => {
    if (f === sortField) setSortDesc((v) => !v);
    else {
      setSortField(f);
      setSortDesc(true);
    }
  };

  const exportCsv = () => {
    if (!data) return;
    const headers = [
      "name", "email",
      "candidates_added", "applications_progressed",
      "interviews_evaluated", "offers_extended", "hires_made",
      "avg_time_to_screen_hours",
      "conv_applied_to_screened", "conv_screened_to_offer",
      "llm_cost_usd",
    ];
    const rows = sorted.map((r) => [
      r.name, r.email,
      r.candidates_added, r.applications_progressed,
      r.interviews_evaluated, r.offers_extended, r.hires_made,
      r.avg_time_to_screen_hours ?? "",
      r.conversion.applied_to_screened, r.conversion.screened_to_offer,
      r.llm_cost_usd,
    ]);
    const csv =
      headers.join(",") +
      "\n" +
      rows
        .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
        .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recruiters_${start}_${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const leaders = useMemo(() => {
    if (!data || data.recruiters.length === 0) return null;
    const top = (key: SortField) =>
      [...data.recruiters].sort((a, b) => {
        const av = (a[key] as number | null) ?? -Infinity;
        const bv = (b[key] as number | null) ?? -Infinity;
        return bv - av;
      })[0];
    const fastest = [...data.recruiters]
      .filter((r) => r.avg_time_to_screen_hours != null)
      .sort(
        (a, b) =>
          (a.avg_time_to_screen_hours ?? Infinity) -
          (b.avg_time_to_screen_hours ?? Infinity),
      )[0];
    return {
      candidates: top("candidates_added"),
      progressed: top("applications_progressed"),
      offers: top("offers_extended"),
      fastest,
    };
  }, [data]);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/reports"
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 mb-1"
        >
          <ArrowLeftIcon className="h-3 w-3" />
          Reports
        </Link>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Recruiter productivity
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Per-recruiter activity over the selected window. Owner-only.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={load}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-md"
            >
              <ArrowPathIcon className="h-4 w-4" />
              Refresh
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={!data || sorted.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50"
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Date filter */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
            From
          </label>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-300 rounded-md"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
            To
          </label>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-300 rounded-md"
          />
        </div>
        <div className="flex gap-2 ml-2">
          {([
            { label: "7d", days: 7 },
            { label: "30d", days: 30 },
            { label: "90d", days: 90 },
          ] as const).map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setStart(daysAgoIso(p.days));
                setEnd(todayIso());
              }}
              className="px-2 py-1 text-xs font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 rounded"
            >
              {p.label}
            </button>
          ))}
        </div>
        {data?.first_attributed_event_at && (
          <p className="ml-auto text-[11px] text-slate-500">
            Data starts {new Date(data.first_attributed_event_at).toLocaleDateString()}
          </p>
        )}
      </div>

      {error && (
        <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {/* Leaderboard cards */}
      {leaders && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <LeaderCard
            label="Most candidates added"
            name={leaders.candidates?.name}
            value={leaders.candidates?.candidates_added ?? 0}
            unit=""
          />
          <LeaderCard
            label="Most applications progressed"
            name={leaders.progressed?.name}
            value={leaders.progressed?.applications_progressed ?? 0}
            unit=""
          />
          <LeaderCard
            label="Most offers extended"
            name={leaders.offers?.name}
            value={leaders.offers?.offers_extended ?? 0}
            unit=""
          />
          <LeaderCard
            label="Fastest time-to-screen"
            name={leaders.fastest?.name}
            value={leaders.fastest?.avg_time_to_screen_hours ?? null}
            unit="h"
          />
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <Th onClick={() => setSort("name")} active={sortField === "name"} desc={sortDesc}>Recruiter</Th>
              <Th onClick={() => setSort("candidates_added")} active={sortField === "candidates_added"} desc={sortDesc} align="right">Candidates</Th>
              <Th onClick={() => setSort("applications_progressed")} active={sortField === "applications_progressed"} desc={sortDesc} align="right">Progressed</Th>
              <Th onClick={() => setSort("interviews_evaluated")} active={sortField === "interviews_evaluated"} desc={sortDesc} align="right">Evaluated</Th>
              <Th onClick={() => setSort("offers_extended")} active={sortField === "offers_extended"} desc={sortDesc} align="right">Offers</Th>
              <Th onClick={() => setSort("hires_made")} active={sortField === "hires_made"} desc={sortDesc} align="right">Hires</Th>
              <Th onClick={() => setSort("avg_time_to_screen_hours")} active={sortField === "avg_time_to_screen_hours"} desc={sortDesc} align="right">Time-to-screen</Th>
              <th className="px-3 py-2 text-right">App→Screen</th>
              <th className="px-3 py-2 text-right">Screen→Offer</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={9} className="px-3 py-3">
                    <div className="h-6 bg-slate-100 rounded animate-pulse" />
                  </td>
                </tr>
              ))
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-sm text-slate-500">
                  No recruiter activity in this window.
                </td>
              </tr>
            ) : (
              sorted.map((r) => (
                <tr key={r.user_id} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-slate-800">{r.name}</div>
                    <div className="text-[11px] text-slate-500">{r.email}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.candidates_added.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.applications_progressed.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.interviews_evaluated.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.offers_extended.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{r.hires_made.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                    {r.avg_time_to_screen_hours == null
                      ? "—"
                      : `${r.avg_time_to_screen_hours}h`}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                    {(r.conversion.applied_to_screened * 100).toFixed(0)}%
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                    {(r.conversion.screened_to_offer * 100).toFixed(0)}%
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-500">
        Note: hires_made is currently approximated by the
        &quot;shortlisted&quot; transition until custom hiring stages
        (Feature 3) ship. LLM cost attribution per recruiter requires
        wiring `actioned_by_user_id` into LLMCallTimer — coming in a follow-up.
      </p>
    </div>
  );
}

function LeaderCard({
  label,
  name,
  value,
  unit,
}: {
  label: string;
  name?: string | null;
  value: number | null;
  unit: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
        {label}
      </p>
      <p className="text-base font-semibold text-slate-900 mt-1 truncate">
        {name || "—"}
      </p>
      <p className="text-2xl font-bold tabular-nums text-indigo-700 mt-0.5">
        {value == null ? "—" : `${value}${unit}`}
      </p>
    </div>
  );
}

function Th({
  onClick,
  active,
  desc,
  align,
  children,
}: {
  onClick: () => void;
  active: boolean;
  desc: boolean;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2 cursor-pointer select-none ${
        align === "right" ? "text-right" : "text-left"
      } ${active ? "text-slate-900" : "text-slate-500"}`}
    >
      {children}
      {active && <span className="ml-1">{desc ? "↓" : "↑"}</span>}
    </th>
  );
}
