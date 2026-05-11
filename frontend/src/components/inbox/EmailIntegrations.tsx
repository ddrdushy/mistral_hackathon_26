"use client";

import { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";

export type ProviderId =
  | "gmail"
  | "outlook"
  | "yahoo"
  | "icloud"
  | "exchange"
  | "aol"
  | "imap"
  | "pop3";

interface ProviderPreset {
  id: ProviderId;
  name: string;
  description: string;
  badge?: string;
  authMethod: "imap" | "pop3";
  imapHost?: string;
  imapPort?: number;
  imapSsl?: boolean;
  helpText?: string;
  helpUrl?: string;
  bg: string;
  glyph: React.ReactNode;
}

interface MailAccount {
  id: number;
  provider: ProviderId;
  auth_method: string;
  email_address: string;
  imap_host: string;
  imap_port: number;
  imap_ssl: boolean;
  status: "connected" | "error" | "disconnected";
  listener_enabled: boolean;
  last_error: string | null;
  last_sync_at: string | null;
  last_synced_count: number;
  created_at: string;
}

const PROVIDERS: ProviderPreset[] = [
  {
    id: "gmail",
    name: "Gmail",
    description: "Google Workspace & gmail.com via IMAP + app password.",
    badge: "IMAP",
    authMethod: "imap",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSsl: true,
    helpText: "Generate an App Password at myaccount.google.com → Security → App passwords (2-Step Verification required).",
    helpUrl: "https://myaccount.google.com/apppasswords",
    bg: "bg-gradient-to-br from-red-500 to-rose-600",
    glyph: (
      <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
        <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 010 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" />
      </svg>
    ),
  },
  {
    id: "outlook",
    name: "Outlook / Microsoft 365",
    description: "outlook.com, hotmail, live & M365 mailboxes via IMAP.",
    badge: "IMAP",
    authMethod: "imap",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapSsl: true,
    helpText: "Use a Microsoft App Password (Account → Security → App passwords).",
    helpUrl: "https://account.microsoft.com/security",
    bg: "bg-gradient-to-br from-sky-500 to-blue-700",
    glyph: (
      <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
        <path d="M7.88 12.04q0 .45-.11.87-.1.41-.33.74-.22.33-.58.52-.37.2-.87.2t-.85-.2q-.35-.21-.57-.55-.22-.33-.33-.75-.1-.42-.1-.86 0-.45.1-.87.1-.43.34-.76.22-.34.59-.54.36-.2.87-.2t.86.2q.35.21.57.55.22.34.31.77.1.43.1.88zM24 12v9.38q0 .46-.33.8-.33.32-.8.32H7.13q-.46 0-.8-.33-.32-.33-.32-.8V18H1q-.41 0-.7-.3-.3-.29-.3-.7V7q0-.41.3-.7Q.58 6 1 6h6.5V2.55q0-.44.3-.75.3-.3.75-.3h12.9q.44 0 .75.3.3.3.3.75V10.85l1.24.72h.01q.1.07.18.18.07.12.07.25zm-6-8.25v3h3v-3zm0 4.5v3h3v-3zm0 4.5v1.83l3.05-1.83zm-5.25-9v3h3.75v-3zm0 4.5v3h3.75v-3zm0 4.5v2.03l2.41 1.5 1.34-.8v-2.73zM9 3.75V6h2l.13.01.12.04v-2.3zM5.98 15.98q.9 0 1.6-.3.7-.32 1.19-.86.48-.55.73-1.28.25-.74.25-1.61 0-.83-.25-1.55-.24-.71-.71-1.24t-1.15-.83q-.68-.3-1.55-.3-.92 0-1.64.3-.71.3-1.2.85-.5.54-.75 1.3-.25.74-.25 1.63 0 .85.26 1.56.26.72.74 1.23.48.52 1.17.81.69.3 1.56.3zM7.5 21h12.39L12 16.08V17q0 .41-.3.7-.29.3-.7.3H7.5zm15-.13v-7.24l-5.9 3.54Z" />
      </svg>
    ),
  },
  {
    id: "yahoo",
    name: "Yahoo Mail",
    description: "yahoo.com mailboxes via IMAP. App password required.",
    badge: "IMAP",
    authMethod: "imap",
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    imapSsl: true,
    helpText: "Generate an app password under Yahoo Account Security.",
    helpUrl: "https://login.yahoo.com/account/security",
    bg: "bg-gradient-to-br from-purple-600 to-fuchsia-700",
    glyph: (
      <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
        <path d="M5.5 6h3.27l2.4 5.97L13.6 6h3.16l-4.78 11.18A4.93 4.93 0 0 1 8.06 20H5.49l1.69-3.92zm12 7.6c.99 0 1.8.81 1.8 1.8s-.81 1.8-1.8 1.8-1.8-.81-1.8-1.8.81-1.8 1.8-1.8zm.31-7.6h2.69l-2.05 6.7h-2.7z" />
      </svg>
    ),
  },
  {
    id: "icloud",
    name: "iCloud Mail",
    description: "@icloud.com / @me.com via IMAP with an app-specific password.",
    badge: "IMAP",
    authMethod: "imap",
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    imapSsl: true,
    helpText: "Create an app-specific password at appleid.apple.com → Sign-in & Security.",
    helpUrl: "https://appleid.apple.com/account/manage",
    bg: "bg-gradient-to-br from-slate-700 to-slate-900",
    glyph: (
      <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83zM13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
      </svg>
    ),
  },
  {
    id: "exchange",
    name: "Microsoft Exchange",
    description: "On-prem Exchange or hosted EWS via IMAP.",
    badge: "IMAP",
    authMethod: "imap",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapSsl: true,
    helpText: "If your tenant blocks basic auth, ask IT for IMAP/OAuth client credentials.",
    bg: "bg-gradient-to-br from-cyan-600 to-blue-800",
    glyph: (
      <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
        <path d="M21.6 3H8.4A2.4 2.4 0 0 0 6 5.4V8H4.5A1.5 1.5 0 0 0 3 9.5v9A1.5 1.5 0 0 0 4.5 20H17a1 1 0 0 0 1-1v-2.6h3.6A2.4 2.4 0 0 0 24 14V5.4A2.4 2.4 0 0 0 21.6 3zM8 18H5v-8h3zm10-3.6H10v-9h12v9z" />
      </svg>
    ),
  },
  {
    id: "aol",
    name: "AOL Mail",
    description: "aol.com / verizon.net mailboxes via IMAP.",
    badge: "IMAP",
    authMethod: "imap",
    imapHost: "imap.aol.com",
    imapPort: 993,
    imapSsl: true,
    helpText: "Use an AOL app password from Account Security settings.",
    bg: "bg-gradient-to-br from-yellow-500 to-orange-600",
    glyph: (
      <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
        <path d="M2.65 13.93H1.16L4.34 5.59h1.93l3.18 8.34H7.91l-.7-1.96H3.36zm1.07-3.04h2.85L5.15 7.04zM23 12.27a1.86 1.86 0 1 1-3.72 0 1.86 1.86 0 0 1 3.72 0zm-7.5 1.66h-1.4V5.6h1.4zm-3.27-1.66a3.4 3.4 0 1 1-6.8 0 3.4 3.4 0 0 1 6.8 0zm-1.4 0a2 2 0 1 0-4 0 2 2 0 0 0 4 0z" />
      </svg>
    ),
  },
  {
    id: "imap",
    name: "Generic IMAP",
    description: "Any IMAP server — set host, port, SSL, and credentials.",
    badge: "Custom",
    authMethod: "imap",
    imapHost: "",
    imapPort: 993,
    imapSsl: true,
    bg: "bg-gradient-to-br from-emerald-500 to-teal-700",
    glyph: (
      <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z" />
      </svg>
    ),
  },
  {
    id: "pop3",
    name: "POP3",
    description: "Legacy POP3 download — host on port 995 (SSL).",
    badge: "Legacy",
    authMethod: "pop3",
    imapHost: "",
    imapPort: 995,
    imapSsl: true,
    helpText: "POP3 fetches and removes mail. Most setups should prefer IMAP.",
    bg: "bg-gradient-to-br from-slate-500 to-slate-700",
    glyph: (
      <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V4zm4 14h8m-4-4v4" />
      </svg>
    ),
  },
];

interface Props {
  onShowToast: (msg: string, type?: "success" | "error") => void;
  onConnected: () => void;
  refreshKey?: number;
}

const PROVIDER_BY_ID: Record<ProviderId, ProviderPreset> = Object.fromEntries(
  // populated below after PROVIDERS is declared
  [],
) as Record<ProviderId, ProviderPreset>;

/**
 * Append authuser=<email> for Google URLs so clicking "Open settings"
 * lands on the typed mailbox, not whatever account is currently active
 * in the browser. Google's account switcher honours this query param on
 * myaccount.google.com / accounts.google.com / mail.google.com.
 *
 * For Microsoft / Yahoo / generic IMAP we just return the URL as-is
 * (their account-switcher is path-based, not query-param-based).
 */
function buildProviderHelpUrl(baseUrl: string, email: string): string {
  const trimmed = (email || "").trim();
  if (!trimmed.includes("@")) return baseUrl;

  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return baseUrl;
  }
  const isGoogle =
    host.endsWith("google.com") || host === "myaccount.google.com";
  if (!isGoogle) return baseUrl;

  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}authuser=${encodeURIComponent(trimmed)}`;
}

function timeAgoShort(iso: string | null): string {
  if (!iso) return "never";
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "never";
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function EmailIntegrations({
  onShowToast,
  onConnected,
  refreshKey,
}: Props) {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [activeProvider, setActiveProvider] = useState<ProviderPreset | null>(null);
  const [host, setHost] = useState("");
  const [port, setPort] = useState(993);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [ssl, setSsl] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyAccountId, setBusyAccountId] = useState<number | null>(null);

  // populate the lookup once on mount (PROVIDERS is module-scoped, immutable)
  useEffect(() => {
    if (Object.keys(PROVIDER_BY_ID).length === 0) {
      for (const p of PROVIDERS) {
        (PROVIDER_BY_ID as Record<string, ProviderPreset>)[p.id] = p;
      }
    }
  }, []);

  const fetchAccounts = useCallback(async () => {
    try {
      const data = await apiGet<{ accounts: MailAccount[] }>("/inbox/accounts");
      setAccounts(data.accounts);
    } catch (err) {
      // Backend may not be migrated yet — fail silently with empty list,
      // since this section gracefully degrades to "add your first inbox".
      void err;
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts, refreshKey]);

  const openModal = (p: ProviderPreset) => {
    setActiveProvider(p);
    setHost(p.imapHost ?? "");
    setPort(p.imapPort ?? (p.authMethod === "pop3" ? 995 : 993));
    setSsl(p.imapSsl ?? true);
    setUser("");
    setPassword("");
  };

  const closeModal = () => {
    setActiveProvider(null);
    setSubmitting(false);
  };

  const handleConnect = async () => {
    if (!user.trim() || !password.trim() || !host.trim() || !activeProvider) {
      onShowToast("Email, password, and host are required", "error");
      return;
    }
    setSubmitting(true);
    try {
      await apiPost("/inbox/accounts", {
        provider: activeProvider.id,
        email_address: user.trim(),
        secret: password,
        imap_host: host.trim(),
        imap_port: port,
        imap_ssl: ssl,
        imap_user: user.trim(),
      });
      onShowToast(`${activeProvider.name} connected — verifying first sync…`);
      closeModal();
      await fetchAccounts();
      // Trigger an immediate sync of the new mailbox (best-effort).
      onConnected();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      onShowToast(msg, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleListener = async (id: number, currentlyEnabled: boolean) => {
    setBusyAccountId(id);
    try {
      await apiPatch(`/inbox/accounts/${id}`, { listener_enabled: !currentlyEnabled });
      onShowToast(
        currentlyEnabled
          ? "Auto-pickup paused — no classifier tokens will be spent on this mailbox"
          : "Auto-pickup resumed — new emails will be classified within ~20s",
      );
      await fetchAccounts();
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : "Could not update listener", "error");
    } finally {
      setBusyAccountId(null);
    }
  };

  const handleDisconnect = async (id: number, email: string) => {
    if (!confirm(`Disconnect ${email}? Already-fetched emails will stay.`)) return;
    setBusyAccountId(id);
    try {
      await apiDelete(`/inbox/accounts/${id}`);
      onShowToast(`Disconnected ${email}`);
      await fetchAccounts();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Disconnect failed";
      onShowToast(msg, "error");
    } finally {
      setBusyAccountId(null);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Email Integrations</h2>
          <p className="text-sm text-slate-500">
            Connect any number of mailboxes — credentials are encrypted at rest and scoped to this tenant.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {accounts.length > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              Auto-pickup active
            </span>
          )}
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
            </svg>
            Encrypted at rest
          </span>
        </div>
      </div>

      {/* ── Connected mailboxes for this tenant ────────────────────────── */}
      {accountsLoading ? (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 mb-5 text-center text-sm text-slate-500">
          Loading connected mailboxes…
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 mb-5 text-center">
          <svg className="w-8 h-8 text-slate-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z" />
          </svg>
          <div className="text-sm font-medium text-slate-700">No mailboxes connected yet</div>
          <div className="text-xs text-slate-500 mt-0.5">Pick a provider below to add your first inbox — credentials are encrypted with your tenant key.</div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 mb-5 overflow-hidden">
          <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-600">
              Connected · {accounts.length}
            </div>
          </div>
          <ul className="divide-y divide-slate-100">
            {accounts.map((acc) => {
              const preset = PROVIDER_BY_ID[acc.provider];
              const busy = busyAccountId === acc.id;
              return (
                <li key={acc.id} className="flex items-center gap-3 px-4 py-3">
                  <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${preset?.bg ?? "bg-slate-200"}`}>
                    {preset?.glyph ?? (
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium text-slate-900 truncate">{acc.email_address}</div>
                      {acc.status === "connected" && acc.listener_enabled && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                          </span>
                          Listening
                        </span>
                      )}
                      {acc.status === "connected" && !acc.listener_enabled && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          Paused
                        </span>
                      )}
                      {acc.status === "error" && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-50 text-red-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                          Error
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {preset?.name ?? acc.provider} · {acc.imap_host}:{acc.imap_port}
                      {" · "}
                      {acc.listener_enabled
                        ? <>Last pickup {timeAgoShort(acc.last_sync_at)}</>
                        : <>Paused — auto-pickup off, no LLM cost</>}
                      {acc.last_synced_count > 0 && acc.listener_enabled && ` (+${acc.last_synced_count})`}
                    </div>
                    {acc.status === "error" && acc.last_error && (
                      <div className="text-[11px] text-red-600 mt-0.5 truncate">{acc.last_error}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Pause / resume toggle — protects classifier LLM tokens */}
                    <button
                      onClick={() => handleToggleListener(acc.id, acc.listener_enabled)}
                      disabled={busy}
                      role="switch"
                      aria-checked={acc.listener_enabled}
                      aria-label={acc.listener_enabled ? "Pause auto-pickup" : "Resume auto-pickup"}
                      title={acc.listener_enabled ? "Pause auto-pickup (saves LLM tokens)" : "Resume auto-pickup"}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                        acc.listener_enabled
                          ? "bg-emerald-500 focus:ring-emerald-500"
                          : "bg-slate-300 focus:ring-slate-400"
                      } ${busy ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                          acc.listener_enabled ? "translate-x-5" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                    <button
                      onClick={() => handleDisconnect(acc.id, acc.email_address)}
                      disabled={busy}
                      className="inline-flex items-center p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                      title="Disconnect"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                      </svg>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── Add a provider ─────────────────────────────────────────────── */}
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
        {accounts.length === 0 ? "Pick a provider" : "Add another mailbox"}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => openModal(p)}
            className="group relative text-left rounded-xl border border-slate-200 bg-white p-4 transition-all hover:shadow-md hover:-translate-y-0.5 hover:border-indigo-300"
          >
            <div className="flex items-start justify-between mb-3">
              <div className={`w-10 h-10 rounded-lg ${p.bg} flex items-center justify-center shadow-sm`}>
                {p.glyph}
              </div>
              {p.badge && (
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                  {p.badge}
                </span>
              )}
            </div>
            <div className="text-sm font-semibold text-slate-900 mb-0.5">{p.name}</div>
            <div className="text-xs text-slate-500 leading-snug min-h-[2rem]">{p.description}</div>

            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs font-medium text-indigo-600 group-hover:text-indigo-700">
                Connect →
              </span>
            </div>
          </button>
        ))}
      </div>

      {activeProvider && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !submitting) closeModal();
          }}
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-slate-200">
            <div className="flex items-start gap-3 p-5 border-b border-slate-100">
              <div className={`w-10 h-10 rounded-lg ${activeProvider.bg} flex items-center justify-center flex-shrink-0`}>
                {activeProvider.glyph}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-base font-semibold text-slate-900">Connect {activeProvider.name}</div>
                <div className="text-xs text-slate-500">{activeProvider.description}</div>
              </div>
              <button
                onClick={closeModal}
                disabled={submitting}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50"
                aria-label="Close"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Server host</label>
                  <input
                    type="text"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="imap.example.com"
                    className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Port</label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(parseInt(e.target.value, 10) || 0)}
                    className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email address</label>
                <input
                  type="email"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="username"
                  className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">App password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••••••"
                  autoComplete="current-password"
                  className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                {activeProvider.helpText && (
                  <p className="mt-1.5 text-[11px] text-slate-500 leading-snug">
                    {activeProvider.helpText}
                    {activeProvider.helpUrl && (
                      <>
                        {" "}
                        <a
                          href={buildProviderHelpUrl(activeProvider.helpUrl, user)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:underline"
                        >
                          Open settings ↗
                        </a>
                      </>
                    )}
                  </p>
                )}
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={ssl}
                  onChange={(e) => setSsl(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                Use SSL/TLS (recommended)
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 p-4 bg-slate-50 rounded-b-xl border-t border-slate-100">
              <button
                onClick={closeModal}
                disabled={submitting}
                className="px-3 py-2 text-sm font-medium rounded-md text-slate-700 hover:bg-slate-200 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConnect}
                disabled={submitting}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Connecting…
                  </>
                ) : (
                  "Connect & Sync"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
