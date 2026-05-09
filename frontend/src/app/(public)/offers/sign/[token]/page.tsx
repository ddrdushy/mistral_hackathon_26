"use client";

import { use, useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api/v1";

interface OfferView {
  offer_id: number;
  html: string;
  status: string;
}

export default function SignOfferPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [data, setData] = useState<OfferView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [name, setName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [done, setDone] = useState<"signed" | "declined" | null>(null);
  const [declineMode, setDeclineMode] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/offers/sign/${token}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || `Could not load offer (${res.status})`);
        }
        const body = (await res.json()) as OfferView;
        if (!cancel) setData(body);
      } catch (e) {
        if (!cancel) setError(e instanceof Error ? e.message : "Failed to load offer");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [token]);

  const sign = async () => {
    if (!name.trim() || !accepted) return;
    try {
      setSigning(true);
      setError(null);
      const res = await fetch(`${API_BASE}/offers/sign/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature_name: name.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Sign failed");
      }
      setDone("signed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign failed");
    } finally {
      setSigning(false);
    }
  };

  const decline = async () => {
    try {
      setSigning(true);
      setError(null);
      const res = await fetch(`${API_BASE}/offers/sign/${token}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: declineReason.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Decline failed");
      }
      setDone("declined");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decline failed");
    } finally {
      setSigning(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="bg-white rounded-xl border border-slate-200 p-8 max-w-md text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900 mb-2">
            Offer unavailable
          </h1>
          <p className="text-sm text-slate-600">
            {error || "This signing link is invalid or has expired."}
          </p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="bg-white rounded-xl border border-slate-200 p-8 max-w-md text-center shadow-sm">
          {done === "signed" ? (
            <>
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-100 flex items-center justify-center">
                <span className="text-emerald-700 text-2xl">✓</span>
              </div>
              <h1 className="text-lg font-semibold text-slate-900 mb-2">
                Offer signed
              </h1>
              <p className="text-sm text-slate-600">
                Thank you, {name}. The hiring team has been notified and will
                follow up with onboarding details.
              </p>
            </>
          ) : (
            <>
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-slate-100 flex items-center justify-center">
                <span className="text-slate-600 text-2xl">×</span>
              </div>
              <h1 className="text-lg font-semibold text-slate-900 mb-2">
                Offer declined
              </h1>
              <p className="text-sm text-slate-600">
                We&apos;ve recorded your response. Best of luck.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 py-8">
      <div className="max-w-3xl mx-auto px-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          {/* Document */}
          <iframe
            srcDoc={data.html}
            className="w-full"
            style={{ height: "calc(100vh - 280px)", minHeight: "500px", border: "none" }}
            title="Offer letter"
          />

          {/* Sign panel */}
          <div className="border-t border-slate-200 p-6 bg-slate-50">
            {!declineMode ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                    Type your full legal name to sign
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Full name"
                    className="w-full px-3 py-2 text-base border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300"
                  />
                  <span>
                    I&apos;ve read this offer letter and agree to its terms.
                    My typed name above is my electronic signature.
                  </span>
                </label>
                {error && (
                  <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                    {error}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={sign}
                    disabled={signing || !name.trim() || !accepted}
                    className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-50"
                  >
                    {signing ? "Signing..." : "Sign offer"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeclineMode(true)}
                    className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-medium text-slate-800">
                  Decline this offer
                </p>
                <textarea
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  rows={3}
                  placeholder="Optional: reason for declining (helps us improve)"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  maxLength={2000}
                />
                {error && (
                  <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                    {error}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={decline}
                    disabled={signing}
                    className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-md disabled:opacity-50"
                  >
                    {signing ? "Submitting..." : "Submit decline"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeclineMode(false);
                      setDeclineReason("");
                    }}
                    className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md"
                  >
                    Back
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
