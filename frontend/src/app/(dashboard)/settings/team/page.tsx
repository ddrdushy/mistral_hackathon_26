"use client";

import { useCallback, useEffect, useState } from "react";
import {
  UsersIcon,
  EnvelopeIcon,
  XCircleIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";

import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthGate";
import type { TeamMember, TeamInvite } from "@/types/index";
import { timeAgo } from "@/lib/constants";
import LoadingSpinner from "@/components/ui/LoadingSpinner";

export default function TeamPage() {
  const { me } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isOwner = me?.user.role === "owner";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, i] = await Promise.all([
        apiGet<{ members: TeamMember[] }>("/team/members"),
        apiGet<{ invites: TeamInvite[] }>("/team/invites"),
      ]);
      setMembers(m.members);
      setInvites(i.invites);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await apiPost("/team/invites", { email: inviteEmail.toLowerCase().trim() });
      setSuccess(`Invitation sent to ${inviteEmail}`);
      setInviteEmail("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (id: number) => {
    if (!confirm("Revoke this invite?")) return;
    try {
      await apiDelete(`/team/invites/${id}`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleRemoveMember = async (m: TeamMember) => {
    if (!confirm(`Remove ${m.email} from the team?`)) return;
    try {
      await apiDelete(`/team/members/${m.id}`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <UsersIcon className="h-5 w-5 text-indigo-600" />
          <h1 className="text-2xl font-semibold text-slate-900">Team</h1>
        </div>
        <p className="text-sm text-slate-500">
          Manage who has access to <strong>{me?.tenant.name}</strong>.
        </p>
      </div>

      {/* Invite form */}
      {isOwner && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Invite a teammate</h2>
          <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              required
              placeholder="teammate@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              <PlusIcon className="w-4 h-4" />
              {submitting ? "Sending..." : "Send invite"}
            </button>
          </form>
          {error && (
            <p className="mt-2 text-xs text-red-600">{error}</p>
          )}
          {success && (
            <p className="mt-2 text-xs text-emerald-600">{success}</p>
          )}
          <p className="mt-2 text-xs text-slate-400">
            Invited members can use everything except billing and team management.
          </p>
        </div>
      )}

      {/* Members */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Members ({members.length})</h2>
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-xs uppercase tracking-wide text-slate-500">
              <th className="text-left font-medium px-5 py-2">Name</th>
              <th className="text-left font-medium px-5 py-2">Email</th>
              <th className="text-left font-medium px-5 py-2">Role</th>
              <th className="text-left font-medium px-5 py-2">Joined</th>
              <th className="text-left font-medium px-5 py-2">Last active</th>
              {isOwner && <th />}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-t border-slate-100">
                <td className="px-5 py-3 text-slate-900 font-medium">
                  {m.name || "—"}
                  {m.id === me?.user.id && (
                    <span className="ml-2 text-xs text-slate-400">(you)</span>
                  )}
                </td>
                <td className="px-5 py-3 text-slate-600">
                  {m.email}
                  {!m.email_verified && (
                    <span className="ml-2 text-[10px] text-amber-600">unverified</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${
                      m.role === "owner"
                        ? "bg-indigo-100 text-indigo-700"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {m.role}
                  </span>
                </td>
                <td className="px-5 py-3 text-slate-500 text-xs">
                  {timeAgo(m.created_at)}
                </td>
                <td className="px-5 py-3 text-slate-500 text-xs">
                  {m.last_login_at ? timeAgo(m.last_login_at) : "never"}
                </td>
                {isOwner && (
                  <td className="px-5 py-3 text-right">
                    {m.role !== "owner" && m.id !== me?.user.id && (
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(m)}
                        className="text-xs font-medium text-red-600 hover:text-red-700"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">
              Pending invitations ({invites.length})
            </h2>
          </div>
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <th className="text-left font-medium px-5 py-2">Email</th>
                <th className="text-left font-medium px-5 py-2">Sent</th>
                <th className="text-left font-medium px-5 py-2">Expires</th>
                {isOwner && <th />}
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => (
                <tr key={inv.id} className="border-t border-slate-100">
                  <td className="px-5 py-3 text-slate-900 inline-flex items-center gap-2">
                    <EnvelopeIcon className="w-4 h-4 text-slate-400" />
                    {inv.email}
                  </td>
                  <td className="px-5 py-3 text-slate-500 text-xs">
                    {timeAgo(inv.created_at)}
                  </td>
                  <td className="px-5 py-3 text-slate-500 text-xs">
                    {timeAgo(inv.expires_at)}
                  </td>
                  {isOwner && (
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleRevoke(inv.id)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700"
                      >
                        <XCircleIcon className="w-3.5 h-3.5" />
                        Revoke
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
