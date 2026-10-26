import { requireUser } from "@/lib/auth";
import { handler, ok, readJson } from "@/lib/http";
import { createHospital, listHospitals } from "@/lib/services/hospitals";
import { hospitalCreateSchema, parse } from "@/lib/validation";

export const GET = handler(async (request) => {
  await requireUser(request, "STAFF");
  const p = request.nextUrl.searchParams;
  return ok(await listHospitals({ q: p.get("q") ?? undefined, city: p.get("city") ?? undefined }));
});

export const POST = handler(async (request) => {
  const actor = await requireUser(request, "STAFF");
  const { first_staff, ...input } = parse(hospitalCreateSchema, await readJson(request));
  const { hospital, activity_log } = await createHospital(actor, input, first_staff);
  return ok(hospital, { status: 201, meta: { activity_log } });
});
