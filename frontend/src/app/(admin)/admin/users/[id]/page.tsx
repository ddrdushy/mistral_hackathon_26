"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckBadgeIcon,
  NoSymbolIcon,
  PlayCircleIcon,
  ShieldCheckIcon,
  ShieldExclamationIcon,
  EnvelopeIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";

import { apiGet, apiPost } from "@/lib/api";
import { useAdmin } from "@/components/admin/AdminGate";
import type { AdminUserItem } from "@/types/index";
import { timeAgo } from "@/lib/constants";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";

export default function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { me } = useAdmin();
  const [u, setU] = useState<AdminUserItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiGet<AdminUserItem>(`/admin/users/${id}`);
      setU(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const flashFor = (s: string) => {
    setFlash(s);
    setTimeout(() => setFlash(null), 4000);
  };

  const handleResetPassword = async () => {
    if (!u) return;
    if (!confirm(`Send a password reset link to ${u.email}?`)) return;
    setPending("reset");
    try {
      await apiPost(`/admin/users/${u.id}/reset-password`);
      flashFor(`Password reset link emailed to ${u.email}.`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setPending(null);
    }
  };

  const handleToggleDisabled = async () => {
    if (!u) return;
    const next = !u.disabled;
    if (
      !confirm(
        next
          ? `Disable ${u.email}? They lose login access immediately.`
          : `Re-enable ${u.email}? They can log in again.`,
      )
    )
      return;
    setPending("disable");
    try {
      await apiPost(`/admin/users/${u.id}/disable`, { disabled: next });
      await load();
      flashFor(next ? "User disabled." : "User re-enabled.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setPending(null);
    }
  };

  const handleVerifyEmail = async () => {
    if (!u) return;
    setPending("verify");
    try {
      await apiPost(`/admin/users/${u.id}/verify-email`);
      await load();
      flashFor("Marked as verified.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setPending(null);
    }
  };

  const handleToggleSuperadmin = async () => {
    if (!u) return;
    const grant = !u.is_superadmin;
    const isSelf = u.id === me.user.id;
    if (
      !confirm(
        grant
          ? `Grant superadmin to ${u.email}? They'll see the entire platform admin shell.`
          : isSelf
            ? `Revoke YOUR OWN superadmin? You'll lose access to /admin immediately.`
            : `Revoke superadmin from ${u.email}?`,
      )
    )
      return;
    setPending("superadmin");
    try {
      await apiPost(`/admin/users/${u.id}/superadmin`, { grant });
      if (isSelf && !grant) {
        // self-revoke: bounce to dashboard
        window.location.href = "/dashboard";
        return;
      }
      await load();
      flashFor(grant ? "Promoted to superadmin." : "Superadmin revoked.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setPending(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <LoadingSpinner size="lg" />
      </div>
    );
  }
  if (error || !u) {
    return (
      <EmptyState
        icon={<UserCircleIcon />}
        title="User not found"
        description={error || "—"}
      />
    );
  }

  const isSelf = u.id === me.user.id;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to users
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-slate-900">
                {u.name || u.email.split("@")[0]}
              </h1>
              {u.is_superadmin && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700">
                  <ShieldCheckIcon className="w-3 h-3" />
                  superadmin
                </span>
              )}
              {u.disabled && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
                  <NoSymbolIcon className="w-3 h-3" />
                  disabled
                </span>
              )}
              {!u.email_verified && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                  unverified
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 inline-flex items-center gap-1.5">
              <EnvelopeIcon className="w-4 h-4" />
              <span className="font-mono">{u.email}</span>
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {u.role} of{" "}
              <Link
                href={`/admin/tenants/${u.tenant_id}`}
                className="text-indigo-600 hover:underline"
              >
                {u.tenant_name}
              </Link>{" "}
              · joined {timeAgo(u.created_at)} ·{" "}
              {u.last_login_at ? `last login ${timeAgo(u.last_login_at)}` : "never logged in"}
              {isSelf && <span className="ml-1 text-indigo-600 font-semibold">· this is you</span>}
            </p>
          </div>
        </div>
      </div>

      {flash && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          ✓ {flash}
        </div>
      )}

      {/* Actions */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-slate-700 mb-2">Support actions</h2>

        <ActionRow
          icon={<ArrowPathIcon className="w-4 h-4" />}
          title="Send password reset link"
          description="Emails the user a one-hour single-use reset link."
          buttonLabel="Send reset link"
          onClick={handleResetPassword}
          pending={pending === "reset"}
        />

        {!u.email_verified && (
          <ActionRow
            icon={<CheckBadgeIcon className="w-4 h-4" />}
            title="Mark email as verified"
            description="Skip the email verification step (support tool)."
            buttonLabel="Mark verified"
            onClick={handleVerifyEmail}
            pending={pending === "verify"}
          />
        )}

        <ActionRow
          icon={u.disabled ? <PlayCircleIcon className="w-4 h-4" /> : <NoSymbolIcon className="w-4 h-4" />}
          title={u.disabled ? "Re-enable user" : "Disable user"}
          description={
            u.disabled
              ? "User can log in again. Existing data is preserved."
              : "Blocks login but keeps data. Less drastic than tenant suspension."
          }
          buttonLabel={u.disabled ? "Re-enable" : "Disable"}
          onClick={handleToggleDisabled}
          pending={pending === "disable"}
          danger={!u.disabled && !isSelf}
          disabled={isSelf}
          disabledReason={isSelf ? "You can't disable yourself" : undefined}
        />

        <ActionRow
          icon={u.is_superadmin ? <ShieldExclamationIcon className="w-4 h-4" /> : <ShieldCheckIcon className="w-4 h-4" />}
          title={u.is_superadmin ? "Revoke superadmin" : "Grant superadmin"}
          description={
            u.is_superadmin
              ? isSelf
                ? "Revokes your own superadmin. You'll lose access to /admin immediately."
                : "Removes platform admin access. Tenant role is unchanged."
              : "Grants full platform admin access (every tenant, every user, GDPR exports, hard-delete)."
          }
          buttonLabel={u.is_superadmin ? "Revoke" : "Grant"}
          onClick={handleToggleSuperadmin}
          pending={pending === "superadmin"}
          danger={u.is_superadmin || !u.is_superadmin}
        />
      </div>
    </div>
  );
}

function ActionRow({
  icon,
  title,
  description,
  buttonLabel,
  onClick,
  pending,
  danger,
  disabled,
  disabledReason,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  buttonLabel: string;
  onClick: () => void;
  pending?: boolean;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-slate-100 last:border-0">
      <div className="flex items-start gap-3 flex-1">
        <span className="text-slate-500 mt-0.5">{icon}</span>
        <div>
          <p className="text-sm font-medium text-slate-800">{title}</p>
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
          {disabled && disabledReason && (
            <p className="text-[11px] text-amber-600 mt-1">{disabledReason}</p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={pending || disabled}
        className={`shrink-0 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          danger
            ? "text-red-700 bg-red-50 hover:bg-red-100"
            : "text-indigo-700 bg-indigo-50 hover:bg-indigo-100"
        }`}
      >
        {pending ? "..." : buttonLabel}
      </button>
    </div>
  );
}
