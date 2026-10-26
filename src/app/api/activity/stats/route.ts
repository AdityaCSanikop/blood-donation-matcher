import { activityStats } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { handler, ok } from "@/lib/http";

/** MongoDB aggregation pipeline: events per day or ISO week, by action. */
export const GET = handler(async (request) => {
  await requireUser(request, "STAFF");
  const p = request.nextUrl.searchParams;
  const granularity = p.get("granularity") ?? "day";
  if (granularity !== "day" && granularity !== "week") throw new AppError(400, "BAD_FILTER", "granularity must be day or week.");
  const days = Math.min(Math.max(Number(p.get("days")) || 30, 1), 366);
  const from = new Date(Date.now() - days * 86_400_000);
  try {
    return ok(await activityStats({ granularity, from }), { meta: { days } });
  } catch {
    throw new AppError(503, "LOG_STORE_UNAVAILABLE", "The activity log (MongoDB) is not reachable right now. Core features still work.");
  }
});
