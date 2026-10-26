import { requireUser } from "@/lib/auth";
import { BLOOD_GROUPS, URGENCY_LEVELS } from "@/lib/constants";
import { AppError } from "@/lib/errors";
import { handler, ok, readJson } from "@/lib/http";
import { createRequest, listRequests } from "@/lib/services/requests";
import { parse, requestSchema, requestStatusFilter } from "@/lib/validation";

export const GET = handler(async (request) => {
  await requireUser(request, "STAFF");
  const p = request.nextUrl.searchParams;
  const status = parse(requestStatusFilter, p.get("status") || undefined);
  const urgency = p.get("urgency") || undefined;
  const blood_group = p.get("blood_group") || undefined;
  if (urgency && !(URGENCY_LEVELS as readonly string[]).includes(urgency)) throw new AppError(400, "BAD_FILTER", "Unknown urgency filter.");
  if (blood_group && !(BLOOD_GROUPS as readonly string[]).includes(blood_group)) throw new AppError(400, "BAD_FILTER", "Unknown blood group filter.");
  const hospital = Number(p.get("hospital_id")) || undefined;
  const items = await listRequests({ status, urgency, blood_group, hospital_id: hospital });
  return ok(items, { meta: { count: items.length, order: "urgency, then oldest first" } });
});

export const POST = handler(async (request) => {
  const actor = await requireUser(request, "STAFF");
  const { request: created, activity_log } = await createRequest(actor, parse(requestSchema, await readJson(request)));
  return ok(created, { status: 201, meta: { activity_log } });
});
