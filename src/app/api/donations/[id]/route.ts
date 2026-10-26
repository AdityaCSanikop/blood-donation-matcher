import { requireUser } from "@/lib/auth";
import { handler, ok } from "@/lib/http";
import { deleteDonation } from "@/lib/services/donations";
import { parseId } from "@/lib/validation";

export const DELETE = handler(async (request, ctx: RouteContext<"/api/donations/[id]">) => {
  const actor = await requireUser(request, "STAFF");
  const { activity_log } = await deleteDonation(actor, parseId((await ctx.params).id, "Donation id"));
  return ok({ deleted: true }, { meta: { activity_log } });
});
