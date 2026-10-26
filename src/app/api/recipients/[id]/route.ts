import { requireUser } from "@/lib/auth";
import { handler, ok, readJson } from "@/lib/http";
import { deleteRecipient, getRecipient, updateRecipient } from "@/lib/services/recipients";
import { parse, parseId, recipientSchema } from "@/lib/validation";

type Ctx = RouteContext<"/api/recipients/[id]">;

export const GET = handler(async (request, ctx: Ctx) => {
  await requireUser(request, "STAFF");
  return ok(await getRecipient(parseId((await ctx.params).id, "Recipient id")));
});

export const PATCH = handler(async (request, ctx: Ctx) => {
  const actor = await requireUser(request, "STAFF");
  const id = parseId((await ctx.params).id, "Recipient id");
  return ok(await updateRecipient(actor, id, parse(recipientSchema.partial(), await readJson(request))));
});

export const DELETE = handler(async (request, ctx: Ctx) => {
  const actor = await requireUser(request, "STAFF");
  await deleteRecipient(actor, parseId((await ctx.params).id, "Recipient id"));
  return ok({ deleted: true });
});
