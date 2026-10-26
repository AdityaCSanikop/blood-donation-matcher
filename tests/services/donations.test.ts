import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, withTransaction } from "@/lib/mysql";
import { closeMongo } from "@/lib/mongo";
import { deleteDonation, recordDonation } from "@/lib/services/donations";
import { cancelRequest } from "@/lib/services/requests";
import { closeAll, dbDaysAgo, logs, makeDonor, makeHospital, makeStaff, q1, requestState, resetData, scenario } from "../helpers";

beforeEach(resetData);
afterAll(async () => {
  await closePool();
  await closeMongo();
  await closeAll();
});

const count = async (table: string) => Number((await q1<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)).n);
const lastDonation = async (donorId: number) => (await q1<{ d: string | null }>("SELECT last_donation_date AS d FROM Donor WHERE donor_id = ?", [donorId])).d;
const give = (staff: Parameters<typeof recordDonation>[0], donorId: number, requestId: number | null, units = 1, date: string | null = null) =>
  recordDonation(staff, { donor_id: donorId, request_id: requestId, units_donated: units, donation_date: date });

describe("recording a donation (transaction)", () => {
  it("partial fulfilment, then full fulfilment", async () => {
    const { staff, requestId } = await scenario({ units: 3 });
    const first = await give(staff, await makeDonor(), requestId, 1);
    expect(first.request).toMatchObject({ status: "Partially_Fulfilled", units_fulfilled: 1, units_remaining: 2 });

    const second = await give(staff, await makeDonor(), requestId, 2);
    expect(second.request).toMatchObject({ status: "Fulfilled", units_fulfilled: 3, units_remaining: 0 });
    expect(await count("Donation")).toBe(2);
  });

  it("updates the donor's last donation date, which makes them ineligible for the next 90 days", async () => {
    const { staff, requestId } = await scenario({ units: 5 });
    const donorId = await makeDonor();
    await give(staff, donorId, requestId);
    expect(await lastDonation(donorId)).toBe(await dbDaysAgo(0));
    await expect(give(staff, donorId, requestId)).rejects.toMatchObject({ status: 409, code: "DONOR_NOT_ELIGIBLE" });
  });

  it("records a walk-in donation that is not tied to any request", async () => {
    const hospitalId = await makeHospital();
    const staff = await makeStaff(hospitalId);
    const result = await give(staff, await makeDonor(), null);
    expect(result.request).toBeNull();
    expect(result.donation).toMatchObject({ request_id: null, hospital_id: hospitalId, units_donated: 1 });
  });

  it("prevents over-fulfilment and rolls everything back", async () => {
    const { staff, requestId } = await scenario({ units: 1 });
    const donorId = await makeDonor();
    await expect(give(staff, donorId, requestId, 2)).rejects.toMatchObject({ status: 409, code: "OVER_FULFILLMENT" });

    expect(await count("Donation")).toBe(0);
    expect(await count("Activity_Outbox")).toBe(0);
    expect(await lastDonation(donorId)).toBeNull();
    expect(await requestState(requestId)).toEqual({ status: "Pending", units_required: 1, units_fulfilled: 0 });
  });

  it.each([
    ["an unavailable donor", { availability_status: "Unavailable" }, "DONOR_UNAVAILABLE", 409],
    ["an incompatible donor", { blood_group: "AB+" }, "DONOR_INCOMPATIBLE", 422],
  ])("rejects %s and changes nothing", async (_label, donor, code, status) => {
    const { staff, requestId } = await scenario({ group: "O+" });
    await expect(give(staff, await makeDonor(donor), requestId)).rejects.toMatchObject({ status, code });
    expect(await count("Donation")).toBe(0);
    expect((await requestState(requestId)).units_fulfilled).toBe(0);
  });

  it("rejects a donor inside the 90-day interval, measured at the donation date", async () => {
    const { staff, requestId } = await scenario();
    const donorId = await makeDonor({ last_donation_date: await dbDaysAgo(89) });
    await expect(give(staff, donorId, requestId)).rejects.toMatchObject({ code: "DONOR_NOT_ELIGIBLE" });
    const ok = await makeDonor({ last_donation_date: await dbDaysAgo(90) });
    await expect(give(staff, ok, requestId)).resolves.toBeTruthy();
  });

  it("rejects a future donation date", async () => {
    const { staff, requestId } = await scenario();
    await expect(give(staff, await makeDonor(), requestId, 1, await dbDaysAgo(-2))).rejects.toMatchObject({ code: "DONATION_DATE_IN_FUTURE" });
  });

  it("rejects donations to cancelled and to already fulfilled requests", async () => {
    const a = await scenario({ units: 1 });
    await cancelRequest(a.staff, a.requestId);
    await expect(give(a.staff, await makeDonor(), a.requestId)).rejects.toMatchObject({ status: 409, code: "REQUEST_CANCELLED" });

    const b = await scenario({ units: 1 });
    await give(b.staff, await makeDonor(), b.requestId);
    await expect(give(b.staff, await makeDonor(), b.requestId)).rejects.toMatchObject({ status: 409, code: "REQUEST_ALREADY_FULFILLED" });
    expect((await requestState(b.requestId)).units_fulfilled).toBe(1);
  });

  it("404 for an unknown donor or request", async () => {
    const { staff, requestId } = await scenario();
    await expect(give(staff, 999999, requestId)).rejects.toMatchObject({ status: 404, code: "DONOR_NOT_FOUND" });
    await expect(give(staff, await makeDonor(), 999999)).rejects.toMatchObject({ status: 404 });
  });

  it("staff of another hospital cannot record a donation against this request", async () => {
    const { requestId } = await scenario();
    const outsider = await makeStaff(await makeHospital());
    await expect(give(outsider, await makeDonor(), requestId)).rejects.toMatchObject({ status: 403 });
    expect(await count("Donation")).toBe(0);
  });
});

describe("transaction rollback", () => {
  it("a failure AFTER the donation was inserted undoes the insert and every trigger effect", async () => {
    const { hospitalId, requestId } = await scenario({ units: 2 });
    const donorId = await makeDonor();

    await expect(
      withTransaction(async (conn) => {
        await conn.query("CALL sp_record_donation(?, ?, ?, CURDATE(), 1, @id)", [donorId, hospitalId, requestId]);
        // Inside the transaction the changes are visible...
        const [rows] = await conn.query("SELECT units_fulfilled, status FROM Blood_Request WHERE request_id = ?", [requestId]);
        expect((rows as { units_fulfilled: number; status: string }[])[0]).toEqual({ units_fulfilled: 1, status: "Partially_Fulfilled" });
        throw new Error("simulated crash before COMMIT");
      }),
    ).rejects.toThrow("simulated crash");

    // ...and after the rollback none of them exist.
    expect(await count("Donation")).toBe(0);
    expect(await lastDonation(donorId)).toBeNull();
    expect(await requestState(requestId)).toEqual({ status: "Pending", units_required: 2, units_fulfilled: 0 });
  });
});

describe("concurrency", () => {
  it("two simultaneous donations for the last unit: exactly one wins", async () => {
    const { staff, requestId } = await scenario({ units: 1 });
    const donors = [await makeDonor(), await makeDonor()];
    const results = await Promise.allSettled(donors.map((d) => give(staff, d, requestId)));

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409, code: "REQUEST_ALREADY_FULFILLED" });
    expect(await requestState(requestId)).toEqual({ status: "Fulfilled", units_required: 1, units_fulfilled: 1 });
    expect(await count("Donation")).toBe(1);
  });

  it("eight simultaneous 1-unit donations for a 3-unit request: exactly three are accepted", async () => {
    const { staff, requestId } = await scenario({ units: 3 });
    const donors = await Promise.all(Array.from({ length: 8 }, () => makeDonor()));
    const results = await Promise.allSettled(donors.map((d) => give(staff, d, requestId)));

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await requestState(requestId)).toEqual({ status: "Fulfilled", units_required: 3, units_fulfilled: 3 });
    expect(Number((await q1<{ s: number }>("SELECT SUM(units_donated) AS s FROM Donation WHERE request_id = ?", [requestId])).s)).toBe(3);
  });

  it("the same donor submitted twice at once is only accepted once", async () => {
    const { staff, requestId } = await scenario({ units: 4 });
    const donorId = await makeDonor();
    const results = await Promise.allSettled([give(staff, donorId, requestId), give(staff, donorId, requestId)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await requestState(requestId)).units_fulfilled).toBe(1);
  });
});

describe("deleting a donation", () => {
  it("reverses the fulfilment and logs both the deletion and the status change", async () => {
    const { staff, requestId } = await scenario({ units: 1 });
    const donorId = await makeDonor();
    const { donation } = await give(staff, donorId, requestId);
    const id = (donation as { donation_id: number }).donation_id;

    await deleteDonation(staff, id);
    expect(await requestState(requestId)).toEqual({ status: "Pending", units_required: 1, units_fulfilled: 0 });
    expect(await lastDonation(donorId)).toBeNull();

    const actions = (await (await logs()).find({ "related.request_id": requestId }).sort({ timestamp: 1 }).toArray()).map((d) => d.action);
    expect(actions).toEqual(["donation_recorded", "request_status_changed", "donation_deleted", "request_status_changed"]);
  });

  it("another hospital's staff cannot delete it", async () => {
    const { staff, requestId } = await scenario();
    const { donation } = await give(staff, await makeDonor(), requestId);
    const outsider = await makeStaff(await makeHospital());
    await expect(deleteDonation(outsider, (donation as { donation_id: number }).donation_id)).rejects.toMatchObject({ status: 403 });
    expect(await count("Donation")).toBe(1);
  });
});
