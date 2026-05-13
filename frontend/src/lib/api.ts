// Default to same-origin /api/v1 so a build with a missing NEXT_PUBLIC_API_URL
// hits its own backend (via the reverse proxy) instead of an unrelated host.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api/v1";

/** Absolute URL to an API path — for plain <a href> downloads where you
 * want the browser to send cookies and follow the response (Content-
 * Disposition) directly instead of going through fetch(). */
export const apiUrl = (path: string): string => `${API_BASE}${path}`;

interface ApiOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string>;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, params } = options;

  let url = `${API_BASE}${path}`;
  if (params) {
    const searchParams = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== "" && v !== undefined && v !== null)
    );
    const qs = searchParams.toString();
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });

  // Auto-redirect to login on auth failure (only in browser, not SSR)
  if (res.status === 401 && typeof window !== "undefined") {
    const isAuthPage = /^\/(login|signup|forgot-password|reset-password|verify-email|$)/.test(
      window.location.pathname,
    );
    if (!isAuthPage) {
      window.location.href = "/login?next=" + encodeURIComponent(window.location.pathname);
    }
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Request failed" }));
    let message: string;
    if (typeof error.detail === "string") {
      message = error.detail;
    } else if (Array.isArray(error.detail)) {
      // FastAPI Pydantic validation errors come as
      // { detail: [{type, loc, msg, ...}] } — flatten to a readable line.
      message = error.detail
        .map((d: { msg?: string; loc?: unknown[] }) => {
          const field = Array.isArray(d.loc) ? d.loc.slice(1).join(".") : "";
          return field ? `${field}: ${d.msg || ""}` : d.msg || "";
        })
        .filter(Boolean)
        .join("; ") || `API error: ${res.status}`;
    } else {
      message = `API error: ${res.status}`;
    }
    throw new Error(message);
  }

  if (res.headers.get("content-type")?.includes("text/csv")) {
    return (await res.blob()) as unknown as T;
  }

  return res.json();
}

export const apiGet = <T>(path: string, params?: Record<string, string>) =>
  api<T>(path, { params });

export const apiPost = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body });

export const apiPatch = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "PATCH", body });

export const apiPut = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "PUT", body });

export const apiDelete = <T>(path: string) =>
  api<T>(path, { method: "DELETE" });
