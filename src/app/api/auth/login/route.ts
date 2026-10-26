import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { handler, ok, readJson } from "@/lib/http";
import { login } from "@/lib/services/users";
import { loginSchema, parse } from "@/lib/validation";

export const POST = handler(async (request) => {
  const { email, password } = parse(loginSchema, await readJson(request));
  const user = await login(email, password);
  const response = ok(user);
  response.cookies.set(SESSION_COOKIE, await createSessionToken(user), sessionCookieOptions);
  return response;
});
