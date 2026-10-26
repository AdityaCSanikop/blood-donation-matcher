import { requireUser } from "@/lib/auth";
import { handler, ok, readJson } from "@/lib/http";
import { deleteHospital, getHospital, updateHospital } from "@/lib/services/hospitals";
import { hospitalSchema, parse, parseId } from "@/lib/validation";

type Ctx = RouteContext<"/api/hospitals/[id]">;

export const GET = handler(async (request, ctx: Ctx) => {
  await requireUser(request, "STAFF");
  return ok(await getHospital(parseId((await ctx.params).id, "Hospital id")));
});

export const PATCH = handler(async (request, ctx: Ctx) => {
  const actor = await requireUser(request, "STAFF");
  const id = parseId((await ctx.params).id, "Hospital id");
  return ok(await updateHospital(actor, id, parse(hospitalSchema.partial(), await readJson(request))));
});

export const DELETE = handler(async (request, ctx: Ctx) => {
  await requireUser(request, "STAFF");
  await deleteHospital(parseId((await ctx.params).id, "Hospital id"));
  return ok({ deleted: true });
});
