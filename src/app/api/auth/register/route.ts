import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { handler, ok, readJson } from "@/lib/http";
import { registerDonor } from "@/lib/services/users";
import { donorRegistrationSchema, parse } from "@/lib/validation";

/** Public: a donor creates their own profile and login. */
export const POST = handler(async (request) => {
  const input = parse(donorRegistrationSchema, await readJson(request));
  const user = await registerDonor(input);
  const response = ok(user, { status: 201 });
  response.cookies.set(SESSION_COOKIE, await createSessionToken(user), sessionCookieOptions);
  return response;
});
