"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  PlusIcon,
  XMarkIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface ProviderCatalogItem {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  auth_method: string;
  logo: string | null;
}

interface Integration {
  id: number;
  provider: string;
  provider_account_id: string;
  sync_enabled: boolean;
  sync_status: string;
  last_synced_at: string | null;
  last_error: string;
  settings: Record<string, unknown>;
  push_ai_signals: boolean;
}

interface SyncLog {
  id: number;
  started_at: string | null;
  finished_at: string | null;
  direction: string;
  status: string;
  records_processed: number;
  records_failed: number;
  error_summary: string;
  payload: Record<string, unknown>;
}

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  paused: "bg-slate-100 text-slate-600",
  error: "bg-rose-100 text-rose-700",
  auth_failed: "bg-rose-100 text-rose-700",
  disconnected: "bg-slate-100 text-slate-600",
};

export default function HrisIntegrationsPage() {
  const [providers, setProviders] = useState<ProviderCatalogItem[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectProvider, setConnectProvider] = useState<ProviderCatalogItem | null>(null);
  const [details, setDetails] = useState<Integration | null>(null);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [pcat, intl] = await Promise.all([
        apiGet<{ providers: ProviderCatalogItem[] }>("/integrations/hris/available"),
        apiGet<{ integrations: Integration[] }>("/integrations/hris"),
      ]);
      setProviders(pcat.providers ?? []);
      setIntegrations(intl.integrations ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byProvider = (providerId: string) =>
    integrations.find((i) => i.provider === providerId);

  const openDetails = async (integ: Integration) => {
    setDetails(integ);
    try {
      const res = await apiGet<{ logs: SyncLog[] }>(
        `/integrations/hris/${integ.id}/logs?limit=20`,
      );
      setLogs(res.logs ?? []);
    } catch {
      setLogs([]);
    }
  };

  const sync = async (integration_id: number) => {
    try {
      setBusy(true);
      await apiPost(`/integrations/hris/${integration_id}/sync`);
      await load();
      const updated = (await apiGet<{ integrations: Integration[] }>("/integrations/hris")).integrations.find((i) => i.id === integration_id);
      if (updated) openDetails(updated);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (integration_id: number) => {
    if (!confirm("Disconnect this integration? Existing data stays — sync stops.")) return;
    try {
      setBusy(true);
      await apiDelete(`/integrations/hris/${integration_id}`);
      setDetails(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 mb-1"
        >
          <ArrowLeftIcon className="h-3 w-3" />
          Settings
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">
          HRIS / ATS integrations
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Two-way sync with your existing applicant tracking system.
          v1 ships the Mock provider for end-to-end testing; Merge.dev,
          Greenhouse, and Lever adapters are scaffolded and disabled
          until their network code lands.
        </p>
      </div>

      {error && (
        <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-40 bg-white border border-slate-200 rounded-xl animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {providers.map((p) => {
            const integ = byProvider(p.id);
            return (
              <div
                key={p.id}
                className={`bg-white border rounded-xl p-4 ${
                  integ ? "border-indigo-300" : "border-slate-200"
                }`}
              >
                <div className="flex items-start gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center flex-shrink-0 text-xs font-bold">
                    {p.id.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-slate-900 truncate">
                      {p.name}
                    </h3>
                    {!p.enabled && !integ && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                        Coming soon
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-600 mb-3 line-clamp-2">
                  {p.description}
                </p>

                {/* 'Want this prioritized?' link for disabled providers —
                    deep-links to /support with the ticket composer pre-filled
                    so tenants can express interest without losing context. */}
                {!p.enabled && !integ && (
                  <Link
                    href={`/support?compose=1&category=feature_request&priority=normal&subject=${encodeURIComponent(
                      `Prioritize ${p.name} HRIS integration`,
                    )}&description=${encodeURIComponent(
                      `We'd like ${p.name} HRIS sync prioritized. Please let us know the ETA.`,
                    )}`}
                    className="inline-flex items-center gap-1 mb-3 text-[11px] font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
                  >
                    Want this prioritized? Let us know →
                  </Link>
                )}

                {integ ? (
                  <>
                    <div className="flex items-center gap-2 text-xs mb-2">
                      <span
                        className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold ${
                          STATUS_BADGE[integ.sync_status] || STATUS_BADGE.disconnected
                        }`}
                      >
                        {integ.sync_status}
                      </span>
                      {integ.last_synced_at && (
                        <span className="text-slate-500">
                          synced {new Date(integ.last_synced_at).toLocaleString()}
                        </span>
                      )}
                    </div>
                    {integ.last_error && (
                      <p className="text-[11px] text-rose-700 truncate mb-2">
                        {integ.last_error}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openDetails(integ)}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        Manage
                      </button>
                      <button
                        type="button"
                        onClick={() => sync(integ.id)}
                        disabled={busy}
                        className="text-xs font-medium text-slate-700 hover:text-slate-900 inline-flex items-center gap-1"
                      >
                        <ArrowPathIcon className="h-3.5 w-3.5" />
                        Sync now
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={!p.enabled}
                    onClick={() => setConnectProvider(p)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Connect
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {connectProvider && (
        <ConnectModal
          provider={connectProvider}
          onClose={() => setConnectProvider(null)}
          onConnected={() => {
            setConnectProvider(null);
            load();
          }}
        />
      )}

      {details && (
        <DetailsDrawer
          integration={details}
          logs={logs}
          onClose={() => setDetails(null)}
          onSync={() => sync(details.id)}
          onDisconnect={() => disconnect(details.id)}
          busy={busy}
        />
      )}
    </div>
  );
}

function ConnectModal({
  provider,
  onClose,
  onConnected,
}: {
  provider: ProviderCatalogItem;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [seed, setSeed] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [publicToken, setPublicToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    try {
      setBusy(true);
      setError(null);
      const body: Record<string, string> = {};
      if (provider.auth_method === "seed") body.seed = seed.trim() || "default";
      else if (provider.auth_method === "api_key") {
        if (!apiKey.trim()) throw new Error("API key required");
        body.api_key = apiKey.trim();
      } else if (provider.auth_method === "public_token") {
        if (!publicToken.trim()) throw new Error("Public token required");
        body.public_token = publicToken.trim();
      }
      await apiPost(`/integrations/hris/connect/${provider.id}`, body);
      onConnected();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connect failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Connect {provider.name}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">{provider.description}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-4 space-y-3">
          {provider.auth_method === "seed" && (
            <div>
              <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                Seed string
              </label>
              <input
                type="text"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder='Leave blank for "default"'
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                The mock provider keys its in-memory store off this seed.
                Different seeds = isolated demo datasets.
              </p>
            </div>
          )}
          {provider.auth_method === "api_key" && (
            <div>
              <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                API key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
              />
            </div>
          )}
          {provider.auth_method === "public_token" && (
            <div>
              <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                Merge Link public token
              </label>
              <input
                type="text"
                value={publicToken}
                onChange={(e) => setPublicToken(e.target.value)}
                placeholder="public_..."
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Captured by Merge Link in the frontend, then exchanged
                server-side for a per-tenant account token.
              </p>
            </div>
          )}
          {provider.auth_method === "oauth" && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              OAuth flow not yet implemented. Configure provider creds
              manually until the OAuth handshake lands.
            </p>
          )}

          {error && (
            <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </div>
        <div className="px-6 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-md"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !provider.enabled}
            className="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50"
          >
            {busy ? "Connecting..." : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailsDrawer({
  integration,
  logs,
  onClose,
  onSync,
  onDisconnect,
  busy,
}: {
  integration: Integration;
  logs: SyncLog[];
  onClose: () => void;
  onSync: () => void;
  onDisconnect: () => void;
  busy: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-end bg-slate-900/50"
      onClick={onClose}
    >
      <div
        className="bg-white shadow-xl border-l border-slate-200 h-full w-full max-w-xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">
            {integration.provider}
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold ${
                STATUS_BADGE[integration.sync_status] || STATUS_BADGE.disconnected
              }`}
            >
              {integration.sync_status}
            </span>
            {integration.last_synced_at && (
              <span className="text-xs text-slate-500">
                Last sync: {new Date(integration.last_synced_at).toLocaleString()}
              </span>
            )}
          </div>

          {integration.last_error && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
              <ExclamationCircleIcon className="h-3.5 w-3.5 inline mr-1" />
              {integration.last_error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSync}
              disabled={busy}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50"
            >
              <ArrowPathIcon className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
              Sync now
            </button>
            <button
              type="button"
              onClick={onDisconnect}
              disabled={busy}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 rounded-md disabled:opacity-50"
            >
              <TrashIcon className="h-4 w-4" />
              Disconnect
            </button>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
              Recent syncs
            </h3>
            {logs.length === 0 ? (
              <p className="text-xs text-slate-500">No syncs yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-md">
                {logs.map((l) => (
                  <li key={l.id} className="px-3 py-2 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold ${
                          l.status === "success"
                            ? "bg-emerald-100 text-emerald-700"
                            : l.status === "failed"
                            ? "bg-rose-100 text-rose-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {l.status}
                      </span>
                      <span className="text-slate-500">{l.direction}</span>
                      <span className="text-slate-400">
                        {l.started_at ? new Date(l.started_at).toLocaleString() : ""}
                      </span>
                      <span className="ml-auto text-slate-700">
                        {l.records_processed} records
                      </span>
                    </div>
                    {l.error_summary && (
                      <p className="text-rose-700 mt-1 truncate">{l.error_summary}</p>
                    )}
                    {Object.keys(l.payload ?? {}).length > 0 && (
                      <p className="text-slate-500 mt-1 font-mono text-[11px]">
                        {JSON.stringify(l.payload)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
