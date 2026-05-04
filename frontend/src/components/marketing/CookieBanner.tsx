"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const KEY = "hireops:cookie-consent";

export default function CookieBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem(KEY)) {
      // Tiny delay so it doesn't flash on top of LCP
      const t = setTimeout(() => setShow(true), 700);
      return () => clearTimeout(t);
    }
  }, []);

  const accept = () => {
    localStorage.setItem(KEY, "accepted");
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-md z-50">
      <div className="bg-slate-900 text-white rounded-xl shadow-2xl shadow-slate-900/30 p-5">
        <p className="text-sm font-semibold mb-1">We use minimal cookies</p>
        <p className="text-xs text-slate-300 leading-relaxed mb-3">
          A session cookie keeps you logged in. We don&apos;t run ad trackers. See our{" "}
          <Link href="/legal/cookies" className="underline hover:text-white">
            cookie policy
          </Link>
          .
        </p>
        <button
          type="button"
          onClick={accept}
          className="w-full inline-flex items-center justify-center px-3 py-2 rounded-lg bg-white text-slate-900 text-sm font-semibold hover:bg-slate-100 transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
