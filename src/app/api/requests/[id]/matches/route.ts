import { requireUser } from "@/lib/auth";
import { DISCLAIMER } from "@/lib/constants";
import { handler, ok } from "@/lib/http";
import { matchDonors } from "@/lib/services/requests";
import { parseId } from "@/lib/validation";

/** Ranked compatible donors for a request (stored procedure sp_match_donors). */
export const GET = handler(async (request, ctx: RouteContext<"/api/requests/[id]/matches">) => {
  await requireUser(request, "STAFF");
  const id = parseId((await ctx.params).id, "Request id");
  const includeIneligible = request.nextUrl.searchParams.get("include_ineligible") === "1";
  const result = await matchDonors(id, includeIneligible);
  return ok(result, { meta: { disclaimer: DISCLAIMER } });
});
