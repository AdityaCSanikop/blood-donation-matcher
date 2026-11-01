import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool } from "@/lib/mysql";
import { closeMongo } from "@/lib/mongo";
import { cancelRequest, matchDonors } from "@/lib/services/requests";
import { offerHelp, openRequestsForDonor, withdrawHelp } from "@/lib/services/donors";
import { closeAll, dbDaysAgo, makeDonor, makeDonorUser, makeStaff, q, resetData, scenario } from "../helpers";

beforeEach(resetData);
afterAll(async () => {
  await closePool();
  await closeMongo();
  await closeAll();
});

describe("donor offers to help", () => {
  it("shows the offer to the donor and in the staff match list, and can be withdrawn", async () => {
    const { requestId } = await scenario({ group: "A+" });
    const donorId = await makeDonor({ blood_group: "A+" });
    const actor = await makeDonorUser(donorId);

    expect((await offerHelp(actor, donorId, requestId)).changed).toBe(true);
    expect((await offerHelp(actor, donorId, requestId)).changed).toBe(false);
    expect((await matchDonors(requestId)).matches[0].offered_help).toBe(true);
    const [open] = await openRequestsForDonor(donorId);
    expect(Number((open as { offered_help: number }).offered_help)).toBe(1);

    expect((await withdrawHelp(actor, donorId, requestId)).changed).toBe(true);
    expect((await matchDonors(requestId)).matches[0].offered_help).toBe(false);
  });

  it("refuses an incompatible blood group", async () => {
    const { requestId } = await scenario({ group: "O-" });
    const donorId = await makeDonor({ blood_group: "A+" });
    await expect(offerHelp(await makeDonorUser(donorId), donorId, requestId)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a closed request", async () => {
    const { requestId, hospitalId } = await scenario({ group: "A+" });
    await cancelRequest(await makeStaff(hospitalId), requestId);
    const donorId = await makeDonor({ blood_group: "A+" });
    await expect(offerHelp(await makeDonorUser(donorId), donorId, requestId)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a donor inside the 90-day interval", async () => {
    const { requestId } = await scenario({ group: "A+" });
    const donorId = await makeDonor({ blood_group: "A+", last_donation_date: await dbDaysAgo(10) });
    await expect(offerHelp(await makeDonorUser(donorId), donorId, requestId)).rejects.toMatchObject({ status: 409 });
    expect(await q("SELECT * FROM Donor_Response")).toHaveLength(0);
  });
});
