"use client";

/**
 * Entitlements provider — pulls /billing/me once on auth and exposes
 * isAllowed(agentName) to anywhere in the app. Lets gated UI surfaces
 * (buttons, sidebar entries) render their disabled state SYNCHRONOUSLY
 * without each one having to re-fetch.
 *
 * Falls open: when the fetch fails or returns early, every agent is
 * treated as allowed so a transient blip doesn't lock HR out of the
 * product. Backend still enforces — this is purely UI affordance.
 */

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { apiGet } from "@/lib/api";

interface CurrentPlan {
  plan: string;
  display_name: string;
  unlocked_agents: string[];
  locked_agents: string[];
  is_trial: boolean;
}

interface Entitlements {
  /** Plan slug — "free" | "starter" | "pro" | custom. */
  plan: string;
  /** Plan display name for user-facing messages. */
  planLabel: string;
  /** True when an agent name is on the tenant's allow-list. */
  isAllowed: (agent: string) => boolean;
  /** True while we're still loading — callers that gate should default
   * to "allowed" during this brief window to avoid flicker. */
  loading: boolean;
  /** True when the tenant is on Trial. */
  isTrial: boolean;
  /** Re-fetch — call after a plan change so the UI updates. */
  refresh: () => Promise<void>;
}

const Ctx = createContext<Entitlements | null>(null);

export function EntitlementsProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<CurrentPlan | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await apiGet<CurrentPlan>("/billing/me");
      setData(res);
    } catch {
      // Fail-open: treat everything as allowed if we can't read the
      // plan. Backend still gates with proper 402s so users aren't
      // exposed to functions they shouldn't be able to run.
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo<Entitlements>(() => {
    const unlocked = new Set(data?.unlocked_agents ?? []);
    const allUnlocked =
      data === null || data.unlocked_agents.length === 0
        ? loading
        : data.unlocked_agents.includes("*");
    return {
      plan: data?.plan ?? "",
      planLabel: data?.display_name ?? "",
      isTrial: data?.is_trial ?? false,
      isAllowed: (agent: string) => {
        if (loading) return true; // optimistic while we resolve
        if (data === null) return true; // fail open
        if (allUnlocked || unlocked.has("*")) return true;
        return unlocked.has(agent);
      },
      loading,
      refresh,
    };
  }, [data, loading, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEntitlements(): Entitlements {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Used outside the provider — return permissive defaults so the
    // surface still renders. Should only happen in tests / detached
    // routes.
    return {
      plan: "",
      planLabel: "",
      isTrial: false,
      isAllowed: () => true,
      loading: false,
      refresh: async () => {},
    };
  }
  return ctx;
}

/**
 * Convenience hook — returns whether a single agent is allowed plus a
 * standard "contact us" mailto link tailored to that agent.
 */
export function useGate(agent: string): {
  allowed: boolean;
  loading: boolean;
  contactHref: string;
  planLabel: string;
} {
  const { isAllowed, loading, planLabel } = useEntitlements();
  const contactHref =
    "mailto:contact@symprio.com" +
    `?subject=${encodeURIComponent(`Enable ${agent} on our HireOps plan`)}`;
  return {
    allowed: isAllowed(agent),
    loading,
    contactHref,
    planLabel: planLabel || "your current plan",
  };
}
