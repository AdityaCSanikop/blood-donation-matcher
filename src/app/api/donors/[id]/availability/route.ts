import { requireUser } from "@/lib/auth";
import { handler, ok, readJson } from "@/lib/http";
import { setAvailability } from "@/lib/services/donors";
import { availabilitySchema, parse, parseId } from "@/lib/validation";

/** Staff, or the donor themself, switches availability. Logged to MongoDB. */
export const PATCH = handler(async (request, ctx: RouteContext<"/api/donors/[id]/availability">) => {
  const actor = await requireUser(request);
  const id = parseId((await ctx.params).id, "Donor id");
  const { availability_status } = parse(availabilitySchema, await readJson(request));
  const { donor, changed, activity_log } = await setAvailability(actor, id, availability_status);
  return ok(donor, { meta: { changed, activity_log } });
});
