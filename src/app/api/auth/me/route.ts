import { requireUser } from "@/lib/auth";
import { handler, ok } from "@/lib/http";
import { getPool, one } from "@/lib/mysql";

export const GET = handler(async (request) => {
  const user = await requireUser(request);
  const hospital = user.hospital_id
    ? await one<{ name: string; city: string }>(getPool(), "SELECT name, city FROM Hospital WHERE hospital_id = ?", [user.hospital_id])
    : null;
  return ok({ ...user, hospital_name: hospital?.name ?? null, hospital_city: hospital?.city ?? null });
});
