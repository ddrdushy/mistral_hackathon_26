"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowLeftIcon,
  UserCircleIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";
import { useAuth } from "@/components/auth/AuthGate";
import { apiPatch, apiPost } from "@/lib/api";

/**
 * Per-user profile page. Lives in the dashboard (no admin features).
 * Splits cleanly into three cards: identity, password, and a small
 * notifications-preferences placeholder. Identity + password are
 * fully wired; notifications prefs are stored in-browser for v1 since
 * the actual notification surface (bell dropdown) reads from the live
 * /api/v1/notifications feed without needing per-user opt-in yet.
 */

const NOTIFY_PREF_KEY = "hireops.notifications.preferences";

interface NotificationPrefs {
  interview_events: boolean;
  whatsapp_replies: boolean;
  pipeline_changes: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  interview_events: true,
  whatsapp_replies: true,
  pipeline_changes: true,
};

export default function ProfileSettingsPage() {
  const { me, refresh } = useAuth();

  const [name, setName] = useState(me?.user.name || "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNote, setProfileNote] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwNote, setPwNote] = useState<string | null>(null);

  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [prefsSaved, setPrefsSaved] = useState(false);

  useEffect(() => {
    setName(me?.user.name || "");
  }, [me?.user.name]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(NOTIFY_PREF_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
        setPrefs({ ...DEFAULT_PREFS, ...parsed });
      }
    } catch {
      /* ignore */
    }
  }, []);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileNote(null);
    try {
      await apiPatch("/auth/me", { name: name.trim() });
      await refresh();
      setProfileNote("Saved.");
    } catch (err) {
      setProfileNote(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwNote(null);
    if (newPassword.length < 8) {
      setPwError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError("New password and confirmation don't match.");
      return;
    }
    setSavingPw(true);
    try {
      await apiPost("/auth/me/change-password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setPwNote("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Change failed");
    } finally {
      setSavingPw(false);
    }
  };

  const setPref = (key: keyof NotificationPrefs, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setPrefsSaved(false);
    try {
      window.localStorage.setItem(NOTIFY_PREF_KEY, JSON.stringify(next));
      setPrefsSaved(true);
      setTimeout(() => setPrefsSaved(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="max-w-3xl">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 mb-4"
      >
        <ArrowLeftIcon className="w-4 h-4" />
        Back to settings
      </Link>

      <div className="flex items-center gap-2 mb-2">
        <UserCircleIcon className="w-6 h-6 text-indigo-600" />
        <h1 className="text-2xl font-bold text-slate-900">
          Profile &amp; notifications
        </h1>
      </div>
      <p className="text-sm text-slate-600 mb-6">
        Your personal account settings on this workspace. Changes here only
        affect you, not other recruiters on the team.
      </p>

      {/* Identity */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-slate-900 mb-1">Identity</h2>
        <p className="text-xs text-slate-500 mb-4">
          Your display name shows on candidate timeline events and the
          recruiter sidebar.
        </p>
        <form onSubmit={saveProfile} className="space-y-3">
          <Field label="Display name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g. Dushyanth Ramalingam"
            />
          </Field>
          <Field label="Email" hint="Changing your sign-in email isn't supported yet — contact support if needed.">
            <input
              type="email"
              value={me?.user.email ?? ""}
              disabled
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
            />
          </Field>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={savingProfile}
              className="inline-flex items-center px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold disabled:opacity-50"
            >
              {savingProfile ? "Saving…" : "Save"}
            </button>
            {profileNote && (
              <span className="text-xs text-emerald-700 font-medium">{profileNote}</span>
            )}
          </div>
        </form>
      </section>

      {/* Password */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-slate-900 mb-1">Password</h2>
        <p className="text-xs text-slate-500 mb-4">
          You&apos;ll be signed out of other sessions; nothing else.
        </p>
        <form onSubmit={changePassword} className="space-y-3">
          <Field label="Current password">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="New password" hint="At least 8 characters.">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
                minLength={8}
              />
            </Field>
            <Field label="Confirm new password">
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
                minLength={8}
              />
            </Field>
          </div>
          {pwError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {pwError}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={savingPw}
              className="inline-flex items-center px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold disabled:opacity-50"
            >
              {savingPw ? "Updating…" : "Change password"}
            </button>
            {pwNote && (
              <span className="text-xs text-emerald-700 font-medium">{pwNote}</span>
            )}
          </div>
        </form>
      </section>

      {/* Notification preferences */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-slate-900">
            Notification preferences
          </h2>
          {prefsSaved && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
              <CheckCircleIcon className="w-4 h-4" /> Saved
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Controls what shows up in your bell dropdown. Stored on this
          device — sync across devices is on the roadmap.
        </p>
        <div className="space-y-2">
          <Toggle
            label="Interview events"
            description="Links generated, opened, started, completed. Reschedule requests."
            checked={prefs.interview_events}
            onChange={(v) => setPref("interview_events", v)}
          />
          <Toggle
            label="WhatsApp replies"
            description="Inbound messages from candidates after a reach-out."
            checked={prefs.whatsapp_replies}
            onChange={(v) => setPref("whatsapp_replies", v)}
          />
          <Toggle
            label="Pipeline changes"
            description="Match / score / shortlist / reject events on your candidates."
            checked={prefs.pipeline_changes}
            onChange={(v) => setPref("pipeline_changes", v)}
          />
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-slate-700 mb-1">{label}</span>
      {children}
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </label>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
      />
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-800">{label}</div>
        <div className="text-xs text-slate-500">{description}</div>
      </div>
    </label>
  );
}
