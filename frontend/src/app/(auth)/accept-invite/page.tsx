"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost } from "@/lib/api";
import type { AcceptInvitePeek } from "@/types/index";

function AcceptInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") || "";

  const [peek, setPeek] = useState<AcceptInvitePeek | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setPeek({
        valid: false,
        email: null,
        tenant_name: null,
        inviter_name: null,
        error: "Missing invite token.",
      });
      return;
    }
    apiGet<AcceptInvitePeek>(`/auth/invite/${token}`)
      .then(setPeek)
      .catch(() =>
        setPeek({
          valid: false,
          email: null,
          tenant_name: null,
          inviter_name: null,
          error: "Failed to load invite.",
        }),
      );
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiPost("/auth/accept-invite", { token, name, password });
      router.push("/dashboard?welcome=invited");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept invite");
    } finally {
      setSubmitting(false);
    }
  };

  if (!peek) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
        <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  if (!peek.valid) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-red-100 mx-auto mb-3 flex items-center justify-center">
          <span className="text-xl font-bold text-red-600">!</span>
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-1">Invite unavailable</h1>
        <p className="text-sm text-slate-500 mb-6">{peek.error}</p>
        <Link href="/login" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Join {peek.tenant_name}</h1>
      <p className="text-sm text-slate-500 mb-6">
        <strong>{peek.inviter_name}</strong> invited <strong>{peek.email}</strong> to the team.
        Set up your account to continue.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="px-3 py-2 rounded-lg bg-red-50 text-red-700 border border-red-200 text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <input
            type="email"
            value={peek.email || ""}
            readOnly
            className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-600"
          />
        </div>

        <div>
          <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1">
            Your name
          </label>
          <input
            id="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            placeholder="At least 8 characters"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {submitting ? "Creating account..." : `Join ${peek.tenant_name}`}
        </button>
      </form>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInner />
    </Suspense>
  );
}
