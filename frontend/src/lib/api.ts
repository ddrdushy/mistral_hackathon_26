const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://dushy2009-hireops-ai.hf.space/api/v1";

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
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(error.detail || `API error: ${res.status}`);
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
