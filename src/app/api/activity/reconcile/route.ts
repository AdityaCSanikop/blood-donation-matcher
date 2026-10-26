import { flushOutbox } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { handler, ok } from "@/lib/http";

/** Retry delivery of activity events that are still waiting in the MySQL outbox. */
export const POST = handler(async (request) => {
  await requireUser(request, "STAFF");
  return ok(await flushOutbox(1000));
});
