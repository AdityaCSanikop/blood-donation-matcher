import { requireUser } from "@/lib/auth";
import { handler, ok, readJson } from "@/lib/http";
import { createRecipient, listRecipients } from "@/lib/services/recipients";
import { parse, recipientSchema } from "@/lib/validation";

export const GET = handler(async (request) => {
  const actor = await requireUser(request, "STAFF");
  const p = request.nextUrl.searchParams;
  // "mine" (default) = the signed-in staff member's hospital; "all" = every hospital.
  const scope = p.get("scope") === "all" ? undefined : (actor.hospital_id ?? undefined);
  return ok(await listRecipients({ hospital_id: scope, q: p.get("q") || undefined, blood_group: p.get("blood_group") || undefined }));
});

export const POST = handler(async (request) => {
  const actor = await requireUser(request, "STAFF");
  const { recipient, activity_log } = await createRecipient(actor, parse(recipientSchema, await readJson(request)));
  return ok(recipient, { status: 201, meta: { activity_log } });
});
