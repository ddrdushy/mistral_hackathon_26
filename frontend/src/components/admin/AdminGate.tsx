"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import type { MeResponse } from "@/types/index";

interface AdminContextValue {
  me: MeResponse;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used inside <AdminGate>");
  return ctx;
}

/**
 * Fetches /me, ensures the caller is a superadmin, redirects otherwise.
 * Used by the (admin) route group's layout — keeps the platform admin shell
 * fully separate from the tenant HR shell.
 */
export default function AdminGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    try {
      const data = await apiGet<MeResponse>("/auth/me");
      if (!data.user.is_superadmin) {
        // Not authorised for the admin shell — bounce to the regular dashboard
        router.replace("/dashboard");
        return;
      }
      setMe(data);
    } catch {
      // apiGet auto-redirects to /login on 401
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const logout = useCallback(async () => {
    try {
      await apiPost("/auth/logout");
    } finally {
      setMe(null);
      router.push("/login");
    }
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="w-10 h-10 border-4 border-slate-700 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!me) {
    return null;  // redirect already in flight
  }

  return (
    <AdminContext.Provider value={{ me, refresh: fetchMe, logout }}>
      {children}
    </AdminContext.Provider>
  );
}
