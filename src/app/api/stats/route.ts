import { requireUser } from "@/lib/auth";
import { handler, ok } from "@/lib/http";
import { dashboard } from "@/lib/services/stats";

export const GET = handler(async (request) => {
  await requireUser(request, "STAFF");
  return ok(await dashboard());
});
