import { requireUser } from "@/lib/auth";
import { handler, ok } from "@/lib/http";
import { cancelRequest } from "@/lib/services/requests";
import { parseId } from "@/lib/validation";

export const POST = handler(async (request, ctx: RouteContext<"/api/requests/[id]/cancel">) => {
  const actor = await requireUser(request, "STAFF");
  const id = parseId((await ctx.params).id, "Request id");
  let reason: string | null = null;
  try {
    const body = (await request.json()) as { reason?: unknown };
    if (typeof body?.reason === "string" && body.reason.trim()) reason = body.reason.trim().slice(0, 200);
  } catch {
    // a body is optional
  }
  const { request: cancelled, activity_log } = await cancelRequest(actor, id, reason);
  return ok(cancelled, { meta: { activity_log } });
});
