"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import type { MeResponse } from "@/types/index";

interface AuthContextValue {
  me: MeResponse | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthGate>");
  return ctx;
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    try {
      const data = await apiGet<MeResponse>("/auth/me");
      setMe(data);
    } catch {
      setMe(null);
      // apiGet auto-redirects to /login on 401, so no manual redirect here
    } finally {
      setLoading(false);
    }
  }, []);

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
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!me) {
    // apiGet should have redirected, but just in case render nothing
    return null;
  }

  return (
    <AuthContext.Provider value={{ me, loading, refresh: fetchMe, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
