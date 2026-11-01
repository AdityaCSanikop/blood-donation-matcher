import { requireUser } from "@/lib/auth";
import { handler, ok } from "@/lib/http";
import { assertDonorAccess, offerHelp, withdrawHelp } from "@/lib/services/donors";
import { parseId } from "@/lib/validation";

type Context = RouteContext<"/api/donors/[id]/requests/[requestId]/response">;

/** The donor offers to help with this request. */
export const POST = handler(async (request, ctx: Context) => {
  const actor = await requireUser(request, "DONOR");
  const params = await ctx.params;
  const id = parseId(params.id, "Donor id");
  assertDonorAccess(actor, id);
  return ok(await offerHelp(actor, id, parseId(params.requestId, "Request id")));
});

/** The donor withdraws the offer. */
export const DELETE = handler(async (request, ctx: Context) => {
  const actor = await requireUser(request, "DONOR");
  const params = await ctx.params;
  const id = parseId(params.id, "Donor id");
  assertDonorAccess(actor, id);
  return ok(await withdrawHelp(actor, id, parseId(params.requestId, "Request id")));
});
