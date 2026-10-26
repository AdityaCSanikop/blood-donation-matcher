import { requireUser } from "@/lib/auth";
import { AVAILABILITY, BLOOD_GROUPS } from "@/lib/constants";
import { AppError } from "@/lib/errors";
import { handler, ok, readJson } from "@/lib/http";
import { createDonor, listDonors } from "@/lib/services/donors";
import { donorSchema, parse } from "@/lib/validation";

export const GET = handler(async (request) => {
  await requireUser(request, "STAFF");
  const p = request.nextUrl.searchParams;
  const blood_group = p.get("blood_group") || undefined;
  const availability = p.get("availability") || undefined;
  const ready = p.get("ready") || undefined;
  if (blood_group && !(BLOOD_GROUPS as readonly string[]).includes(blood_group)) throw new AppError(400, "BAD_FILTER", "Unknown blood group filter.");
  if (availability && !(AVAILABILITY as readonly string[]).includes(availability)) throw new AppError(400, "BAD_FILTER", "Unknown availability filter.");
  if (ready && ready !== "yes" && ready !== "no") throw new AppError(400, "BAD_FILTER", "ready must be yes or no.");
  const { items, search } = await listDonors({
    q: p.get("q") || undefined,
    city: p.get("city") || undefined,
    blood_group,
    availability,
    ready: ready as "yes" | "no" | undefined,
  });
  return ok(items, { meta: { count: items.length, search } });
});

export const POST = handler(async (request) => {
  const actor = await requireUser(request, "STAFF");
  const { donor, activity_log } = await createDonor(actor, parse(donorSchema, await readJson(request)));
  return ok(donor, { status: 201, meta: { activity_log } });
});
