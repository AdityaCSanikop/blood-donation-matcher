import { requireUser } from "@/lib/auth";
import { handler, ok, readJson } from "@/lib/http";
import { getRequest, updateRequest } from "@/lib/services/requests";
import { parse, parseId, requestUpdateSchema } from "@/lib/validation";

type Ctx = RouteContext<"/api/requests/[id]">;

export const GET = handler(async (request, ctx: Ctx) => {
  await requireUser(request, "STAFF");
  return ok(await getRequest(parseId((await ctx.params).id, "Request id")));
});

export const PATCH = handler(async (request, ctx: Ctx) => {
  const actor = await requireUser(request, "STAFF");
  const id = parseId((await ctx.params).id, "Request id");
  const { request: updated, activity_log } = await updateRequest(actor, id, parse(requestUpdateSchema, await readJson(request)));
  return ok(updated, { meta: { activity_log } });
});
