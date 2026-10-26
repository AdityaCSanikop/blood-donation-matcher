import { requireUser } from "@/lib/auth";
import { handler, ok, readJson } from "@/lib/http";
import { assertDonorAccess, deleteDonor, getDonor, updateDonor } from "@/lib/services/donors";
import { listDonations } from "@/lib/services/donations";
import { donorUpdateSchema, parse, parseId } from "@/lib/validation";

type Ctx = RouteContext<"/api/donors/[id]">;

export const GET = handler(async (request, ctx: Ctx) => {
  const actor = await requireUser(request);
  const id = parseId((await ctx.params).id, "Donor id");
  assertDonorAccess(actor, id);
  const [donor, donations] = await Promise.all([getDonor(id), listDonations({ donor_id: id })]);
  return ok({ ...donor, donations });
});

export const PATCH = handler(async (request, ctx: Ctx) => {
  const actor = await requireUser(request);
  const id = parseId((await ctx.params).id, "Donor id");
  const { donor, activity_log } = await updateDonor(actor, id, parse(donorUpdateSchema, await readJson(request)));
  return ok(donor, { meta: { activity_log } });
});

export const DELETE = handler(async (request, ctx: Ctx) => {
  await requireUser(request, "STAFF");
  await deleteDonor(parseId((await ctx.params).id, "Donor id"));
  return ok({ deleted: true });
});
