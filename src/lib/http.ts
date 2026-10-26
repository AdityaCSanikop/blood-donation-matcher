/** Small helpers so every Route Handler returns errors in the same JSON shape. */
import { NextResponse, type NextRequest } from "next/server";
import { AppError, toAppError } from "./errors";

export type ApiError = { error: { code: string; message: string; fields?: Record<string, string> } };

export function ok<T>(data: T, init?: { status?: number; meta?: Record<string, unknown> }) {
  return NextResponse.json(init?.meta ? { data, meta: init.meta } : { data }, { status: init?.status ?? 200 });
}

export function fail(err: unknown) {
  const appErr = toAppError(err);
  if (appErr.status >= 500 && !(err instanceof AppError)) {
    console.error("[api] unexpected error:", err);
  }
  const fields = (appErr.details as { fields?: Record<string, string> } | undefined)?.fields;
  const body: ApiError = { error: { code: appErr.code, message: appErr.message, ...(fields ? { fields } : {}) } };
  return NextResponse.json(body, { status: appErr.status });
}

/** Wrap a handler: any thrown error becomes a JSON error response. */
export function handler<C>(fn: (request: NextRequest, ctx: C) => Promise<Response>) {
  return async (request: NextRequest, ctx: C): Promise<Response> => {
    try {
      return await fn(request, ctx);
    } catch (err) {
      return fail(err);
    }
  };
}

export async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError(400, "BAD_JSON", "The request body must be valid JSON.");
  }
}
