"use client";

import { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost } from "@/lib/api";

export type ProviderId = "apollo" | "linkedin" | "indeed" | "jobstreet";

interface Provider {
  id: ProviderId;
  name: string;
  tagline: string;
  auth_method: "api_key" | "oauth";
  platform_managed: boolean;
  byo_enabled: boolean;
  capabilities: string[];
  help_url: string;
  logo_color: string;          // tailwind gradient classes
  status: "active" | "coming_soon";
  active: boolean;             // resolved at runtime by the backend (e.g. Apollo platform key set)
}

interface JobBoardAccount {
  id: number;
  provider: ProviderId;
  auth_method: string;
  account_label: string;
  external_user_id: string;
  capabilities: string[];
  status: "connected" | "error" | "disconnected";
  last_error: string | null;
  last_used_at: string | null;
  created_at: string | null;
}

interface Props {
  onShowToast: (msg: string, type?: "success" | "error") => void;
  onChange?: () => void;
}

const PROVIDER_GLYPH: Record<ProviderId, React.ReactNode> = {
  apollo: (
    <svg viewBox="0 0 24 24" className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M3 12h18M12 3a13 13 0 010 18M12 3a13 13 0 000 18" />
    </svg>
  ),
  linkedin: (
    <svg viewBox="0 0 24 24" className="w-6 h-6 text-white" fill="currentColor">
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.36V9h3.41v1.56h.05a3.74 3.74 0 013.36-1.85c3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 11.01-4.13 2.06 2.06 0 010 4.13zM7.12 20.45H3.55V9h3.57v11.45z" />
    </svg>
  ),
  indeed: (
    <svg viewBox="0 0 24 24" className="w-6 h-6 text-white" fill="currentColor">
      <path d="M13.7 4.36c.62-.41 1.32-.71 2-.93-1.69-.5-3.55-.31-5.25.69a8.62 8.62 0 00-3.78 4.51c.24-.43.55-.86.91-1.23 1.7-1.74 4.07-2.51 6.12-3.04zm-1.61 17.67h2.5V8.55c-.83.4-1.66.66-2.5.86v12.62zm1.27-15.79c.85 0 1.55-.7 1.55-1.55s-.7-1.55-1.55-1.55-1.55.7-1.55 1.55.7 1.55 1.55 1.55z" />
    </svg>
  ),
  jobstreet: (
    <svg viewBox="0 0 24 24" className="w-6 h-6 text-white" fill="currentColor">
      <path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.18L19.82 8 12 11.82 4.18 8 12 4.18zM4 9.61l7 3.5v6.78l-7-3.5V9.61zm9 10.28v-6.78l7-3.5v6.78l-7 3.5z" />
    </svg>
  ),
};

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function JobBoardIntegrations({ onShowToast, onChange }: Props) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [accounts, setAccounts] = useState<JobBoardAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Provider | null>(null);
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([
        apiGet<{ providers: Provider[] }>("/talent/providers"),
        apiGet<{ accounts: JobBoardAccount[] }>("/talent/accounts"),
      ]);
      setProviders(p.providers);
      setAccounts(a.accounts);
    } catch {
      // backend not migrated yet — empty state is fine
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const accountsByProvider = accounts.reduce<Record<string, JobBoardAccount[]>>(
    (acc, a) => {
      (acc[a.provider] = acc[a.provider] || []).push(a);
      return acc;
    },
    {},
  );

  const openModal = (p: Provider) => {
    setActive(p);
    setLabel("");
    setSecret("");
  };

  const close = () => {
    setActive(null);
    setSubmitting(false);
  };

  const handleSubmit = async () => {
    if (!active) return;
    if (!secret.trim()) {
      onShowToast("API key or token is required", "error");
      return;
    }
    setSubmitting(true);
    try {
      await apiPost("/talent/accounts", {
        provider: active.id,
        auth_method: active.auth_method,
        account_label: label.trim() || `${active.name} subscription`,
        secret: secret.trim(),
        capabilities: active.capabilities,
      });
      onShowToast(`${active.name} connected — credentials encrypted at rest`);
      close();
      await fetchAll();
      onChange?.();
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : "Connect failed", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisconnect = async (id: number, name: string) => {
    if (!confirm(`Disconnect ${name}? You can reconnect any time.`)) return;
    setBusyId(id);
    try {
      await apiDelete(`/talent/accounts/${id}`);
      onShowToast(`${name} disconnected`);
      await fetchAll();
      onChange?.();
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : "Disconnect failed", "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Job Boards & Talent Sources</h2>
          <p className="text-sm text-slate-500">
            Apollo is the always-available platform default. Bring your own LinkedIn / Indeed / JobStreet subscription if you have one — credentials are encrypted at rest.
          </p>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3" />
          </svg>
          Encrypted at rest
        </span>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500 italic py-4">Loading providers…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {providers.map((p) => {
            const connected = accountsByProvider[p.id] || [];
            const showActive = p.platform_managed
              ? p.active
              : connected.length > 0;
            const isComingSoon = p.status === "coming_soon" && !p.byo_enabled;

            return (
              <div
                key={p.id}
                className={`rounded-xl border p-4 flex flex-col ${
                  showActive
                    ? "border-emerald-300 bg-emerald-50/30"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${p.logo_color} flex items-center justify-center shadow-sm`}>
                    {PROVIDER_GLYPH[p.id]}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {p.platform_managed && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">
                        Platform
                      </span>
                    )}
                    {p.status === "coming_soon" && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
                        Coming soon
                      </span>
                    )}
                    {showActive && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Active
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-sm font-semibold text-slate-900">{p.name}</div>
                <div className="text-xs text-slate-500 leading-snug min-h-[2rem] mb-3">{p.tagline}</div>

                <div className="flex flex-wrap gap-1 mb-3">
                  {p.capabilities.map((c) => (
                    <span
                      key={c}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 capitalize"
                    >
                      {c.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>

                {connected.length > 0 && (
                  <ul className="mb-3 -mx-1 space-y-1">
                    {connected.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded bg-emerald-50/60 border border-emerald-100"
                      >
                        <span className="text-[11px] font-medium text-emerald-900 flex-1 truncate">
                          {a.account_label}
                        </span>
                        <span className="text-[10px] text-emerald-600">
                          {timeAgo(a.created_at)}
                        </span>
                        <button
                          onClick={() => handleDisconnect(a.id, a.account_label)}
                          disabled={busyId === a.id}
                          className="text-[10px] text-emerald-700 hover:text-red-600 transition-colors"
                          title="Disconnect"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  {p.byo_enabled ? (
                    <button
                      onClick={() => openModal(p)}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                    >
                      {connected.length > 0 ? "Add another →" : "Connect →"}
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">Coming soon</span>
                  )}
                  <a
                    href={p.help_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-slate-400 hover:text-slate-600"
                  >
                    Docs ↗
                  </a>
                </div>
                {isComingSoon && (
                  <p className="text-[10px] text-amber-700 mt-2">
                    Partner agreement pending. Contact admin if you want early access.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !submitting) close();
          }}
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-slate-200">
            <div className="flex items-start gap-3 p-5 border-b border-slate-100">
              <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${active.logo_color} flex items-center justify-center flex-shrink-0`}>
                {PROVIDER_GLYPH[active.id]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-base font-semibold text-slate-900">Connect {active.name}</div>
                <div className="text-xs text-slate-500">{active.tagline}</div>
              </div>
              <button
                onClick={close}
                disabled={submitting}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                aria-label="Close"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-3">
              {active.status === "coming_soon" && (
                <div className="rounded-md bg-amber-50 border border-amber-200 p-2.5 text-[11px] text-amber-800">
                  <strong>Adapter not yet live.</strong> You can store credentials now — search/posting will activate once the {active.name} adapter ships. We&apos;ll email you when ready.
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Account label</label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={`${active.name} (recruiter@acme.com)`}
                  className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="mt-1 text-[10px] text-slate-400">A nickname so you can tell connected accounts apart.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {active.auth_method === "oauth" ? "OAuth refresh token" : "API key"}
                </label>
                <input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="••••••••••••••••••••"
                  autoComplete="off"
                  className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="mt-1 text-[10px] text-slate-500">
                  <a href={active.help_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                    Where do I find this? ↗
                  </a>
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 p-4 bg-slate-50 rounded-b-xl border-t border-slate-100">
              <button
                onClick={close}
                disabled={submitting}
                className="px-3 py-2 text-sm font-medium rounded-md text-slate-700 hover:bg-slate-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
              >
                {submitting ? "Saving…" : "Save & encrypt"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
