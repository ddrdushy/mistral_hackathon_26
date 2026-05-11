"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  GlobeAltIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  TrashIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface Provider {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  auth_fields: string[];
}

interface Connection {
  id: number;
  provider: string;
  enabled: boolean;
  last_error: string;
  settings: Record<string, unknown>;
  connected_at: string | null;
  updated_at: string | null;
}

export default function JobBoardsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, c] = await Promise.all([
        apiGet<{ providers: Provider[] }>("/job-boards/available"),
        apiGet<{ connections: Connection[] }>("/job-boards"),
      ]);
      setProviders(a.providers || []);
      setConnections(c.connections || []);
    } catch {
      setProviders([]);
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const connByProvider = new Map(connections.map((c) => [c.provider, c]));

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/settings"
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← Back to settings
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">Job boards</h1>
        <p className="text-sm text-slate-500 mt-1">
          One-click publish each open role to LinkedIn, Indeed, Facebook,
          MyFutureJobs (Malaysia), and more. Connect a provider once and it
          appears on every job&apos;s &quot;Publish&quot; panel.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading providers…</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {providers.map((p) => {
            const conn = connByProvider.get(p.id);
            return (
              <ProviderCard
                key={p.id}
                provider={p}
                connection={conn}
                connecting={connectingProvider === p.id}
                onConnectClick={() => setConnectingProvider(p.id)}
                onConnectCancel={() => setConnectingProvider(null)}
                onConnected={() => {
                  setConnectingProvider(null);
                  load();
                }}
                onDisconnect={async () => {
                  if (!conn) return;
                  if (!confirm(`Disconnect ${p.name}?`)) return;
                  await apiDelete(`/job-boards/${conn.id}`);
                  load();
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProviderCard({
  provider,
  connection,
  connecting,
  onConnectClick,
  onConnectCancel,
  onConnected,
  onDisconnect,
}: {
  provider: Provider;
  connection?: Connection;
  connecting: boolean;
  onConnectClick: () => void;
  onConnectCancel: () => void;
  onConnected: () => void;
  onDisconnect: () => void;
}) {
  const isConnected = !!connection;
  const hasError = !!connection?.last_error;

  return (
    <div
      className={`bg-white border rounded-xl p-4 ${
        isConnected
          ? hasError
            ? "border-amber-300 ring-1 ring-amber-100"
            : "border-emerald-300 ring-1 ring-emerald-100"
          : "border-slate-200"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
            isConnected
              ? hasError
                ? "bg-amber-50 text-amber-700"
                : "bg-emerald-50 text-emerald-700"
              : "bg-slate-100 text-slate-500"
          }`}
        >
          <GlobeAltIcon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-slate-900">{provider.name}</p>
            {isConnected && !hasError && (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
                <CheckCircleIcon className="w-3 h-3" /> Connected
              </span>
            )}
            {hasError && (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
                <ExclamationTriangleIcon className="w-3 h-3" /> Needs attention
              </span>
            )}
            {!provider.enabled && !isConnected && (
              <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                Coming soon
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1 leading-snug">
            {provider.description}
          </p>
          {hasError && connection?.last_error && (
            <p className="text-[11px] text-amber-700 mt-1.5 leading-snug">
              {connection.last_error}
            </p>
          )}
        </div>
      </div>

      {!connecting && (
        <div className="mt-3 flex gap-2 justify-end">
          {isConnected ? (
            <>
              <button
                type="button"
                onClick={onConnectClick}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md"
              >
                Re-enter credentials
              </button>
              <button
                type="button"
                onClick={onDisconnect}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-md"
              >
                <TrashIcon className="w-3.5 h-3.5" /> Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onConnectClick}
              disabled={!provider.enabled}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
            >
              <PlusIcon className="w-3.5 h-3.5" /> Connect
            </button>
          )}
        </div>
      )}

      {connecting && (
        <ConnectForm
          provider={provider}
          onCancel={onConnectCancel}
          onConnected={onConnected}
        />
      )}
    </div>
  );
}

function ConnectForm({
  provider,
  onCancel,
  onConnected,
}: {
  provider: Provider;
  onCancel: () => void;
  onConnected: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPost(`/job-boards/connect/${provider.id}`, {
        ...values,
        settings: {},
      });
      onConnected();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 border-t border-slate-100 pt-3">
      {provider.auth_fields.map((field) => (
        <div key={field}>
          <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1">
            {field.replace(/_/g, " ")}
          </label>
          <input
            type={field.includes("token") || field.includes("key") ? "password" : "text"}
            value={values[field] || ""}
            onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
            placeholder={
              provider.id === "mock" && field === "seed"
                ? "Any string (e.g. demo)"
                : ""
            }
            className="w-full px-2.5 py-1.5 rounded-md border border-slate-300 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            autoComplete="off"
            required
          />
        </div>
      ))}
      {error && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-md"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="px-2.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-md"
        >
          {submitting ? "Connecting…" : "Save & test"}
        </button>
      </div>
    </form>
  );
}
