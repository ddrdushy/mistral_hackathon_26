"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiPost } from "@/lib/api";
import type { MeResponse } from "@/types/index";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [resending, setResending] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await apiPost<MeResponse>("/auth/signup", {
        name,
        company_name: companyName,
        email,
        password,
      });
      // Superadmins skip the verification gate — drop them into the admin shell.
      if (result.user.is_superadmin) {
        router.push("/admin");
        return;
      }
      // Already-verified accounts (e.g. SSO in the future) skip the check-email step.
      if (result.user.email_verified) {
        router.push("/dashboard?welcome=1");
        return;
      }
      // Show the "check your email" confirmation step. The user is logged in
      // (cookie is set) but we want them to verify before we drop them into the app.
      setMe(result);
      setSubmittedEmail(result.user.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setResendNote(null);
    try {
      await apiPost("/auth/resend-verification");
      setResendNote("Verification email re-sent. Check your inbox.");
    } catch (err) {
      setResendNote(err instanceof Error ? err.message : "Could not resend email");
    } finally {
      setResending(false);
    }
  };

  if (submittedEmail && me) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-indigo-100 mx-auto mb-4 flex items-center justify-center">
          <svg className="w-7 h-7 text-indigo-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Check your email</h1>
        <p className="text-sm text-slate-500 mb-5">
          We sent a verification link to{" "}
          <span className="font-semibold text-slate-900">{submittedEmail}</span>.
          Click it to activate your workspace — the link expires in 24 hours.
        </p>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-left mb-5">
          <p className="text-xs text-slate-600 leading-relaxed">
            <span className="font-semibold text-slate-700">Tip:</span> if it doesn&apos;t arrive in a minute or two, check your spam folder. Some corporate inboxes route automated mail to a quarantine queue.
          </p>
        </div>

        {resendNote && (
          <div className="px-3 py-2 rounded-md bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 mb-4">
            {resendNote}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            {resending ? "Re-sending..." : "Resend verification email"}
          </button>
          <Link
            href="/dashboard?welcome=1"
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
          >
            Continue to dashboard
          </Link>
        </div>

        <p className="mt-5 text-[11px] text-slate-400">
          Wrong address?{" "}
          <button
            type="button"
            onClick={() => {
              setSubmittedEmail(null);
              setMe(null);
              setResendNote(null);
            }}
            className="underline hover:text-slate-600"
          >
            Edit and re-submit
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Start free</h1>
      <p className="text-sm text-slate-500 mb-6">
        Create your HireOps AI workspace. No card required.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="px-3 py-2 rounded-lg bg-red-50 text-red-700 border border-red-200 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1">
              Your name
            </label>
            <input
              id="name"
              type="text"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="Alex Rivera"
            />
          </div>
          <div>
            <label htmlFor="company" className="block text-sm font-medium text-slate-700 mb-1">
              Company
            </label>
            <input
              id="company"
              type="text"
              required
              autoComplete="organization"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="Acme Corp"
            />
          </div>
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
            Work email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            placeholder="alex@acme.com"
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
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            placeholder="At least 8 characters"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Creating account..." : "Create workspace"}
        </button>

        <p className="text-xs text-slate-400 text-center">
          By signing up you agree to our{" "}
          <Link href="/legal/terms" className="hover:text-slate-600 underline">Terms</Link>
          {" "}and{" "}
          <Link href="/legal/privacy" className="hover:text-slate-600 underline">Privacy Policy</Link>.
        </p>
      </form>

      <p className="mt-6 text-sm text-slate-600 text-center">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-indigo-600 hover:text-indigo-700">
          Sign in
        </Link>
      </p>
    </div>
  );
}
