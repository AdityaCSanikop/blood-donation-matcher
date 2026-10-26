import { SESSION_COOKIE } from "@/lib/auth";
import { handler, ok } from "@/lib/http";

export const POST = handler(async () => {
  const response = ok({ signed_out: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
});
