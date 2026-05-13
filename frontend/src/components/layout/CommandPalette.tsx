"use client";

/**
 * Command palette — Cmd-K / Ctrl-K from anywhere inside the dashboard.
 *
 * Three sections, all keyboard-driven:
 *   1. Candidates   — live search against /candidates?search=… (top 5)
 *   2. Navigate     — static list of dashboard routes
 *   3. Actions      — buttons that fire common workflows (sync inbox,
 *                     create job, manage templates, …)
 *
 * Single global instance mounted in DashboardShell. Listens for Cmd-K /
 * Ctrl-K to open, Esc to close. Arrow keys + Enter to navigate.
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightIcon,
  BriefcaseIcon,
  ChartBarIcon,
  ChatBubbleLeftRightIcon,
  Cog6ToothIcon,
  HomeIcon,
  InboxIcon,
  PhoneIcon,
  PlusCircleIcon,
  UserCircleIcon,
  UserGroupIcon,
  VideoCameraIcon,
} from "@heroicons/react/24/outline";

import { apiGet } from "@/lib/api";

interface CandidateHit {
  id: number;
  name: string;
  email: string;
  profile?: { role?: string; seniority?: string };
  first_application_id?: number | null;
}

type ItemKind = "candidate" | "nav" | "action";

interface Item {
  kind: ItemKind;
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

const NAV_ITEMS: Omit<Item, "run" | "kind">[] = [
  { id: "nav-dashboard", label: "Dashboard", hint: "Home / metrics", icon: <HomeIcon className="w-4 h-4" /> },
  { id: "nav-inbox", label: "Inbox", hint: "Triage inbound applications", icon: <InboxIcon className="w-4 h-4" /> },
  { id: "nav-jobs", label: "Jobs", hint: "Open positions", icon: <BriefcaseIcon className="w-4 h-4" /> },
  { id: "nav-candidates", label: "Candidates", hint: "All in pipeline", icon: <UserGroupIcon className="w-4 h-4" /> },
  { id: "nav-talent-bank", label: "Talent bank", hint: "Past candidates by profile", icon: <UserCircleIcon className="w-4 h-4" /> },
  { id: "nav-calls", label: "Call queue", hint: "Outbound voice calls", icon: <PhoneIcon className="w-4 h-4" /> },
  { id: "nav-interviews", label: "Interviews", hint: "Scheduled + completed", icon: <VideoCameraIcon className="w-4 h-4" /> },
  { id: "nav-outreach", label: "Outreach", hint: "Sequences + replies", icon: <ChatBubbleLeftRightIcon className="w-4 h-4" /> },
  { id: "nav-reports", label: "Reports", hint: "Hiring funnel + LLM spend", icon: <ChartBarIcon className="w-4 h-4" /> },
  { id: "nav-settings", label: "Settings", hint: "Integrations, templates, billing", icon: <Cog6ToothIcon className="w-4 h-4" /> },
];

const NAV_HREF: Record<string, string> = {
  "nav-dashboard": "/dashboard",
  "nav-inbox": "/inbox",
  "nav-jobs": "/jobs",
  "nav-candidates": "/candidates",
  "nav-talent-bank": "/talent-bank",
  "nav-calls": "/calls",
  "nav-interviews": "/interviews",
  "nav-outreach": "/outreach",
  "nav-reports": "/reports",
  "nav-settings": "/settings",
};

const ACTION_ITEMS: Omit<Item, "run" | "kind">[] = [
  { id: "act-new-job", label: "Create job", hint: "Draft a JD or paste your own", icon: <PlusCircleIcon className="w-4 h-4" /> },
  { id: "act-sync-inbox", label: "Sync inbox", hint: "Pull latest emails now", icon: <InboxIcon className="w-4 h-4" /> },
  { id: "act-upload-cv", label: "Upload CV to talent bank", hint: "Drop a resume into the talent bank", icon: <UserCircleIcon className="w-4 h-4" /> },
  { id: "act-templates", label: "Edit email templates", hint: "Customise outbound branding", icon: <Cog6ToothIcon className="w-4 h-4" /> },
  { id: "act-billing", label: "Billing & usage", hint: "Plan, quotas, LLM spend", icon: <ChartBarIcon className="w-4 h-4" /> },
];

const ACTION_HREF: Record<string, string> = {
  "act-new-job": "/jobs/new",
  "act-sync-inbox": "/inbox",
  "act-upload-cv": "/talent-bank?upload=1",
  "act-templates": "/settings/templates",
  "act-billing": "/settings/billing",
};

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState<CandidateHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Global keyboard shortcut: Cmd-K / Ctrl-K. Also Esc to close.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isOpenCombo =
        (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isOpenCombo) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (open && e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Focus the input every time we open, reset state.
  useEffect(() => {
    if (open) {
      setQ("");
      setCandidates([]);
      setCursor(0);
      // microtask so input is mounted
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Live candidate search — 200ms debounce.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) {
      setCandidates([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await apiGet<{ candidates: CandidateHit[] }>(
          `/candidates?per_page=5&search=${encodeURIComponent(term)}`,
        );
        setCandidates(res.candidates || []);
      } catch {
        setCandidates([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  const close = useCallback(() => setOpen(false), []);

  const goCandidate = useCallback(
    (hit: CandidateHit) => {
      close();
      router.push(`/candidates/${hit.id}`);
    },
    [close, router],
  );

  const goRoute = useCallback(
    (path: string) => {
      close();
      router.push(path);
    },
    [close, router],
  );

  // Flatten everything into one ordered list so arrow keys work
  // uniformly across sections.
  const items: Item[] = useMemo(() => {
    const lowQ = q.trim().toLowerCase();
    const candItems: Item[] = candidates.map((c) => ({
      kind: "candidate",
      id: `cand-${c.id}`,
      label: c.name || c.email || "Unnamed",
      hint: c.profile?.role || c.email,
      icon: <UserCircleIcon className="w-4 h-4" />,
      run: () => goCandidate(c),
    }));
    const navMatch = NAV_ITEMS.filter(
      (n) => !lowQ || n.label.toLowerCase().includes(lowQ),
    ).map<Item>((n) => ({
      ...n,
      kind: "nav",
      run: () => goRoute(NAV_HREF[n.id] || "/"),
    }));
    const actMatch = ACTION_ITEMS.filter(
      (a) => !lowQ || a.label.toLowerCase().includes(lowQ),
    ).map<Item>((a) => ({
      ...a,
      kind: "action",
      run: () => goRoute(ACTION_HREF[a.id] || "/"),
    }));
    return [...candItems, ...navMatch, ...actMatch];
  }, [candidates, q, goCandidate, goRoute]);

  // Reset cursor when items change.
  useEffect(() => {
    setCursor(0);
  }, [items.length]);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(items.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[cursor];
      if (it) it.run();
    }
  };

  if (!open) return null;

  // Split items back into sections for display labels.
  const sectionLabel = (kind: ItemKind): string =>
    kind === "candidate" ? "Candidates" : kind === "nav" ? "Navigate" : "Actions";

  let lastKind: ItemKind | null = null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-24 px-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="w-full max-w-xl rounded-xl bg-white shadow-2xl ring-1 ring-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <span className="text-slate-400">⌘K</span>
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search candidates, navigate, run an action…"
            className="flex-1 bg-transparent outline-none text-sm text-slate-900 placeholder-slate-400"
          />
          {loading && (
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">
              Searching
            </span>
          )}
        </div>

        <ul className="max-h-[60vh] overflow-y-auto py-1">
          {items.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-slate-500">
              {q.trim().length < 2
                ? "Type to search candidates, or browse navigation + actions."
                : `No matches for "${q.trim()}".`}
            </li>
          ) : (
            items.map((it, i) => {
              const header =
                it.kind !== lastKind ? (
                  <li
                    key={`${it.kind}-header`}
                    className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider text-slate-400 font-semibold"
                  >
                    {sectionLabel(it.kind)}
                  </li>
                ) : null;
              lastKind = it.kind;
              const active = i === cursor;
              return (
                <Fragment key={it.id}>
                  {header}
                  <li>
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => it.run()}
                      className={`w-full text-left flex items-center gap-3 px-4 py-2 ${
                        active ? "bg-indigo-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className={`flex items-center justify-center w-7 h-7 rounded-md ${
                          active
                            ? "bg-indigo-100 text-indigo-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {it.icon}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-slate-900 truncate">
                          {it.label}
                        </span>
                        {it.hint && (
                          <span className="block text-xs text-slate-500 truncate">
                            {it.hint}
                          </span>
                        )}
                      </span>
                      <ArrowRightIcon
                        className={`w-3.5 h-3.5 ${
                          active ? "text-indigo-500" : "text-slate-300"
                        }`}
                      />
                    </button>
                  </li>
                </Fragment>
              );
            })
          )}
        </ul>

        <div className="flex items-center justify-between px-4 py-2 border-t border-slate-100 text-[11px] text-slate-500">
          <span>
            <kbd className="font-mono text-[10px] px-1 rounded bg-slate-100">↑↓</kbd>{" "}
            navigate ·{" "}
            <kbd className="font-mono text-[10px] px-1 rounded bg-slate-100">↵</kbd>{" "}
            select ·{" "}
            <kbd className="font-mono text-[10px] px-1 rounded bg-slate-100">esc</kbd>{" "}
            close
          </span>
          <span className="text-slate-400">HireOps · ⌘K from anywhere</span>
        </div>
      </div>
    </div>
  );
}
