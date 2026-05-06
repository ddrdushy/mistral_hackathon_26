"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthGate";
import JobBoardIntegrations from "@/components/talent/JobBoardIntegrations";

interface TenantUsageReport {
  scope: "tenant";
  days: number;
  total_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost_usd: number;
  by_agent: Record<
    string,
    {
      calls: number;
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      cost_usd: number;
      avg_latency_ms: number;
    }
  >;
}

const fmtMoney = (n: number) => {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
};

const fmtTokens = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

export default function TenantSettingsPage() {
  const router = useRouter();
  const { me } = useAuth();
  const [usage, setUsage] = useState<TenantUsageReport | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [days, setDays] = useState(7);

  const fetchUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      const data = await apiGet<TenantUsageReport>("/settings/llm/usage", {
        days: String(days),
      });
      setUsage(data);
    } catch {
      // tenant has no usage yet — leave null
    } finally {
      setUsageLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  // Redirect superadmins to the platform-scoped settings page so they don't
  // see a tenant-only view by accident.
  useEffect(() => {
    if (me?.user.is_superadmin) {
      router.replace("/admin/settings");
    }
  }, [me, router]);

  if (me?.user.is_superadmin) {
    return (
      <div className="p-6 text-sm text-slate-500">Redirecting to platform settings…</div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Workspace details, your team, billing, and your AI usage. Platform-wide
          configuration (agent IDs, API keys) lives in the platform admin console.
        </p>
      </div>

      {/* ── Workspace card ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Workspace
            </div>
            <h2 className="text-lg font-semibold text-slate-900">{me?.tenant.name ?? "—"}</h2>
            <div className="text-sm text-slate-500">
              Plan:{" "}
              <span className="font-medium text-slate-700 capitalize">{me?.tenant.plan}</span>
              {" · "}
              Slug: <span className="font-mono text-slate-600">{me?.tenant.slug}</span>
            </div>
          </div>
          <Link
            href="/settings/billing"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors"
          >
            Manage plan & billing
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </Link>
        </div>
      </div>

      {/* ── Quick links grid ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <Link
          href="/settings/team"
          className="block bg-white rounded-xl shadow-sm border border-slate-200 p-5 hover:border-indigo-300 hover:shadow-md transition-all"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-6a4 4 0 11-8 0 4 4 0 018 0zm6 0a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">Team & Roles</div>
              <div className="text-xs text-slate-500 mt-0.5">
                Invite recruiters, manage permissions, and remove members.
              </div>
            </div>
          </div>
        </Link>

        <Link
          href="/settings/billing"
          className="block bg-white rounded-xl shadow-sm border border-slate-200 p-5 hover:border-indigo-300 hover:shadow-md transition-all"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">Billing & Plan</div>
              <div className="text-xs text-slate-500 mt-0.5">
                Upgrade, manage payment methods, and view invoices.
              </div>
            </div>
          </div>
        </Link>

        <Link
          href="/inbox"
          className="block bg-white rounded-xl shadow-sm border border-slate-200 p-5 hover:border-indigo-300 hover:shadow-md transition-all"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">Email Integrations</div>
              <div className="text-xs text-slate-500 mt-0.5">
                Connect Gmail, Outlook, Yahoo and other inboxes for HR triage.
              </div>
            </div>
          </div>
        </Link>

        <div className="bg-slate-50 rounded-xl border border-dashed border-slate-300 p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-200 text-slate-500 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-700">Profile & Notifications</div>
              <div className="text-xs text-slate-500 mt-0.5">Coming soon — email preferences and signature.</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Demo data cleanup ─────────────────────────────────────────── */}
      <DemoDataPanel />

      {/* ── Job board integrations (Apollo platform-default + BYO) ────── */}
      <div className="mb-6">
        <JobBoardIntegrations
          onShowToast={(msg, type) => {
            // Lightweight toast — wire into a real toast lib if/when settings grows one.
            if (type === "error") console.error(msg);
            else console.log(msg);
          }}
        />
      </div>

      {/* ── Tenant LLM usage ────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Your AI Usage</h2>
            <p className="text-sm text-slate-500">
              Mistral / ElevenLabs spend attributed to this tenant. Updated in real time.
            </p>
          </div>
          <div className="flex gap-1">
            {[1, 7, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  days === d
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {d === 1 ? "24h" : `${d}d`}
              </button>
            ))}
          </div>
        </div>

        {usageLoading && !usage ? (
          <div className="text-sm text-slate-500 italic">Loading usage…</div>
        ) : usage && usage.total_calls > 0 ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <Stat label="Calls" value={usage.total_calls.toLocaleString()} />
              <Stat label="Tokens" value={fmtTokens(usage.total_tokens)} />
              <Stat label="Cost" value={fmtMoney(usage.total_cost_usd)} accent />
              <Stat label="Window" value={`${usage.days}d`} />
            </div>

            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left">
                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Agent</th>
                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right">Calls</th>
                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right">Tokens</th>
                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right">Cost</th>
                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right">Avg latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {Object.entries(usage.by_agent).map(([name, row]) => (
                    <tr key={name} className="hover:bg-slate-50/60">
                      <td className="px-3 py-2 font-medium text-slate-900">{name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.calls.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtTokens(row.total_tokens)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">{fmtMoney(row.cost_usd)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{row.avg_latency_ms}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="text-sm text-slate-500 italic">
            No AI usage in the last {days} day{days === 1 ? "" : "s"}. Connect an inbox or run a workflow to see numbers here.
          </div>
        )}
      </div>
    </div>
  );
}

function DemoDataPanel() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const onClear = async () => {
    if (!confirm(
      "Remove all demo and seeded sample data?\n\n" +
      "This deletes:\n" +
      "  • Jobs tagged [DEMO]\n" +
      "  • Candidates not sourced from a real email\n" +
      "  • Their applications, interview links, Q&A sessions, events\n\n" +
      "Real candidates from your connected mailbox stay."
    )) return;
    try {
      setBusy(true);
      setResult(null);
      const data = await apiPost<{
        cleared: boolean;
        reason?: string;
        jobs?: number;
        candidates?: number;
        applications?: number;
      }>("/team/clear-demo", {});
      if (!data.cleared) {
        setResult(`Nothing to remove — ${data.reason || "no demo data"}.`);
      } else {
        setResult(
          `Removed ${data.jobs ?? 0} job(s), ${data.candidates ?? 0} candidate(s), ${data.applications ?? 0} application(s).`,
        );
      }
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 mb-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Demo data</h2>
          <p className="text-xs text-slate-500 mt-1 max-w-xl">
            On signup we seed your tenant with a few sample jobs and
            candidates so the dashboard isn&apos;t empty. Once your real
            mailbox is wired up, clear them out.
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="text-sm font-medium px-3 py-1.5 rounded-md border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50 whitespace-nowrap"
        >
          {busy ? "Clearing..." : "Clear demo data"}
        </button>
      </div>
      {result && (
        <p className="mt-3 text-sm text-slate-700 bg-slate-50 rounded-md px-3 py-2">
          {result}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${accent ? "text-indigo-700" : "text-slate-900"}`}>
        {value}
      </div>
    </div>
  );
}
