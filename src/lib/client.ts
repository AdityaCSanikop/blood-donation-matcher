"use client";
/** Browser-side API helper: one place for fetch, JSON and error handling. */

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

export type ApiResult<T> = { data: T; meta: Record<string, unknown> };

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers: options.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiFailure(0, "NETWORK", "Could not reach the server. Check that it is running and try again.");
  }
  let json: { data?: T; meta?: Record<string, unknown>; error?: { code: string; message: string; fields?: Record<string, string> } } = {};
  try {
    json = await response.json();
  } catch {
    // non-JSON response (e.g. a proxy error page)
  }
  if (!response.ok || json.error) {
    if (response.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      // Session expired: a full navigation (not a client-side route change) also clears in-memory state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/login");
    }
    throw new ApiFailure(
      response.status,
      json.error?.code ?? "ERROR",
      json.error?.message ?? `The server answered with status ${response.status}.`,
      json.error?.fields ?? {},
    );
  }
  return { data: json.data as T, meta: json.meta ?? {} };
}

/** Message for the top of a form: field-level problems are shown next to the fields instead. */
export function formError(err: unknown): string {
  if (err instanceof ApiFailure) {
    const keys = Object.keys(err.fields);
    if (keys.length > 0 && !keys.includes("_")) return "Check the highlighted fields and try again.";
  }
  return errorMessage(err);
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
export function formatDateTime(value: string): string {
  const d = new Date(value);
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
