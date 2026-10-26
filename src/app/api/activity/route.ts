import { findActivity, pendingCount, type ActivityFilter } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { handler, ok } from "@/lib/http";

const ENTITY_TYPES = ["donor", "request", "donation", "hospital", "recipient"];

function date(value: string | null, label: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new AppError(400, "BAD_FILTER", `${label} is not a valid date.`);
  return d;
}

/**
 * Activity history from MongoDB.
 * Staff see everything; a donor only ever sees events related to themself.
 */
export const GET = handler(async (request) => {
  const actor = await requireUser(request);
  const p = request.nextUrl.searchParams;
  const entityType = p.get("entity_type") || undefined;
  if (entityType && !ENTITY_TYPES.includes(entityType)) throw new AppError(400, "BAD_FILTER", "Unknown entity type.");

  const filter: ActivityFilter = {
    entity_type: entityType as ActivityFilter["entity_type"],
    entity_id: Number(p.get("entity_id")) || undefined,
    action: p.get("action") || undefined,
    donor_id: Number(p.get("donor_id")) || undefined,
    request_id: Number(p.get("request_id")) || undefined,
    from: date(p.get("from"), "from"),
    to: date(p.get("to"), "to"),
    limit: Number(p.get("limit")) || 50,
    skip: Number(p.get("skip")) || 0,
  };
  if (actor.role === "DONOR") filter.donor_id = actor.donor_id ?? -1;

  try {
    const { items, total } = await findActivity(filter);
    return ok(items, { meta: { total, pending_delivery: actor.role === "STAFF" ? await pendingCount() : undefined } });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(503, "LOG_STORE_UNAVAILABLE", "The activity log (MongoDB) is not reachable right now. Core features still work.");
  }
});
