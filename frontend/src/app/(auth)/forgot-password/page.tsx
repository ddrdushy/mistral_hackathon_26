"use client";

import { useState } from "react";
import Link from "next/link";
import { apiPost } from "@/lib/api";

// Stricter than HTML5 type="email" — HTML5 accepts "foo@bar" (intranet
// addresses), which is almost never what a user means on a public sign-up
// form. Require at least one dot in the domain and a 2+ char TLD.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = email.trim();
  const looksValid = EMAIL_RE.test(trimmed);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!looksValid) {
      setError("Please enter a valid email address (e.g. you@company.com).");
      return;
    }
    setLoading(true);
    try {
      await apiPost("/auth/forgot-password", { email: trimmed });
      setDone(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      // Pydantic email validation comes back as a 422 with a list of
      // errors; surface a friendlier message but keep the underlying
      // detail in case it's something else (rate-limit, server error).
      if (msg.toLowerCase().includes("email")) {
        setError("That email address doesn't look valid. Please double-check it.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-100 mx-auto mb-3 flex items-center justify-center">
          <svg className="w-6 h-6 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-1">Check your inbox</h1>
        <p className="text-sm text-slate-500 mb-6">
          If an account exists for <strong>{email}</strong>, you&apos;ll receive a password reset link in the next few minutes.
        </p>
        <Link href="/login" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
          ← Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Forgot password?</h1>
      <p className="text-sm text-slate-500 mb-6">
        Enter your email and we&apos;ll send you a link to reset it.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError(null);
            }}
            aria-invalid={error ? true : undefined}
            className={`w-full px-3 py-2 rounded-lg border text-sm text-slate-900 focus:outline-none focus:ring-2 focus:border-transparent ${
              error
                ? "border-rose-400 focus:ring-rose-500"
                : "border-slate-300 focus:ring-indigo-500"
            }`}
            placeholder="you@company.com"
          />
          {error && (
            <p className="mt-1.5 text-xs text-rose-600" role="alert">
              {error}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading || !looksValid}
          className="w-full inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Sending..." : "Send reset link"}
        </button>
      </form>

      <p className="mt-6 text-sm text-slate-600 text-center">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-indigo-600 hover:text-indigo-700">
          Sign in
        </Link>
      </p>
    </div>
  );
}
