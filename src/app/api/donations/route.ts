import { requireUser } from "@/lib/auth";
import { handler, ok, readJson } from "@/lib/http";
import { listDonations, recordDonation } from "@/lib/services/donations";
import { donationSchema, parse } from "@/lib/validation";

export const GET = handler(async (request) => {
  const actor = await requireUser(request, "STAFF");
  const p = request.nextUrl.searchParams;
  const scope = p.get("scope") === "all" ? undefined : (actor.hospital_id ?? undefined);
  return ok(
    await listDonations({
      hospital_id: scope,
      donor_id: Number(p.get("donor_id")) || undefined,
      request_id: Number(p.get("request_id")) || undefined,
    }),
  );
});

export const POST = handler(async (request) => {
  const actor = await requireUser(request, "STAFF");
  const { donation, request: updated, activity_log } = await recordDonation(actor, parse(donationSchema, await readJson(request)));
  return ok({ donation, request: updated }, { status: 201, meta: { activity_log } });
});
