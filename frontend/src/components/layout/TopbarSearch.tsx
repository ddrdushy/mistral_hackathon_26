"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MagnifyingGlassIcon, UserCircleIcon } from "@heroicons/react/24/outline";
import { apiGet } from "@/lib/api";

/**
 * Live candidate search dropdown. Debounced 250ms; calls
 * /candidates?per_page=8&search=… and renders the top matches with
 * name + role + email. Picking a result navigates to the candidate
 * detail page if they have an application, or filters the talent bank
 * by the chosen ID. Hitting Enter without picking a row falls back to
 * the existing full-page /candidates?search=… view.
 */

interface Hit {
  id: number;
  name: string;
  email: string;
  phone?: string;
  profile?: { role?: string; seniority?: string };
  first_application_id?: number | null;
}

export default function TopbarSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside-click.
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  // Debounced fetch.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await apiGet<{ candidates: Hit[] }>(
          `/candidates?per_page=8&search=${encodeURIComponent(term)}`,
        );
        setHits(res.candidates || []);
        setOpen(true);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const submit = () => {
    const term = q.trim();
    if (!term) {
      router.push("/candidates");
    } else {
      router.push(`/candidates?search=${encodeURIComponent(term)}`);
    }
    setOpen(false);
  };

  const pick = (hit: Hit) => {
    setOpen(false);
    setQ("");
    if (hit.first_application_id) {
      router.push(`/candidates/${hit.first_application_id}`);
    } else {
      router.push(`/talent-bank?search=${encodeURIComponent(hit.name || hit.email)}`);
    }
  };

  return (
    <div ref={wrapRef} className="hidden md:block relative">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-300 transition-colors"
      >
        <button
          type="submit"
          aria-label="Search"
          className="text-slate-400 hover:text-slate-600"
        >
          <MagnifyingGlassIcon className="w-4 h-4" />
        </button>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => hits.length > 0 && setOpen(true)}
          placeholder="Search name, email, phone, skills…"
          aria-label="Search candidates"
          className="bg-transparent text-sm text-slate-700 placeholder-slate-400 outline-none w-64"
        />
        {/* Hint that Cmd-K / Ctrl-K opens the global command palette.
            Hidden on touch since there's no meta key. */}
        <kbd
          className="hidden sm:inline-flex items-center gap-0.5 text-[10px] font-mono text-slate-400 bg-white/80 border border-slate-200 rounded px-1.5 py-0.5"
          title="Open command palette"
        >
          ⌘K
        </kbd>
      </form>

      {open && q.trim().length >= 2 && (
        <div className="absolute right-0 mt-2 w-96 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-50">
          {loading ? (
            <div className="px-4 py-3 text-xs text-slate-500">Searching…</div>
          ) : hits.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-500">
              No candidates match{" "}
              <span className="font-mono text-xs">&quot;{q.trim()}&quot;</span>.
            </div>
          ) : (
            <>
              <ul className="max-h-96 overflow-y-auto divide-y divide-slate-100">
                {hits.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      onClick={() => pick(hit)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-start gap-3"
                    >
                      <UserCircleIcon className="w-7 h-7 text-slate-300 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-900 truncate">
                          {hit.name || hit.email || "Unnamed"}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {hit.profile?.role || hit.email}
                          {hit.profile?.seniority &&
                            hit.profile.seniority !== "unknown" && (
                              <> · {hit.profile.seniority}</>
                            )}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={submit}
                className="block w-full text-left px-4 py-2 border-t border-slate-100 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
              >
                See all matches for &quot;{q.trim()}&quot; →
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
