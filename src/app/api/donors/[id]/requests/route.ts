import { requireUser } from "@/lib/auth";
import { handler, ok } from "@/lib/http";
import { assertDonorAccess, openRequestsForDonor } from "@/lib/services/donors";
import { parseId } from "@/lib/validation";

/** Open requests this donor's blood group could help with (no patient details). */
export const GET = handler(async (request, ctx: RouteContext<"/api/donors/[id]/requests">) => {
  const actor = await requireUser(request);
  const id = parseId((await ctx.params).id, "Donor id");
  assertDonorAccess(actor, id);
  return ok(await openRequestsForDonor(id));
});
