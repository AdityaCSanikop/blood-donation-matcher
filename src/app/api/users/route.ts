import { requireUser } from "@/lib/auth";
import { handler, ok, readJson } from "@/lib/http";
import { createStaffUser } from "@/lib/services/users";
import { parse, staffUserSchema } from "@/lib/validation";

/** Staff adds another staff login for their own hospital. */
export const POST = handler(async (request) => {
  const actor = await requireUser(request, "STAFF");
  const user = await createStaffUser(actor, parse(staffUserSchema, await readJson(request)));
  return ok(user, { status: 201 });
});
