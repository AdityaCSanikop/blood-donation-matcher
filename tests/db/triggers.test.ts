import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeAll, db, dbDaysAgo, makeDonor, makeHospital, makeRecipient, makeRequest, q, q1, requestState, resetData, scenario } from "../helpers";

beforeEach(resetData);
afterAll(closeAll);

const donate = async (donorId: number, hospitalId: number, requestId: number | null, units = 1, date?: string) => {
  const [r] = await (await db()).query(
    "INSERT INTO Donation (donor_id, hospital_id, request_id, donation_date, units_donated) VALUES (?,?,?,COALESCE(?, CURDATE()),?)",
    [donorId, hospitalId, requestId, date ?? null, units],
  );
  return (r as { insertId: number }).insertId;
};
const signal = (message: string) => ({ errno: 1644, sqlMessage: message });

describe("fn_is_donor_eligible (90-day rule)", () => {
  it.each([
    [null, 1, "no donation on record"],
    [89, 0, "89 days ago"],
    [90, 1, "exactly 90 days ago"],
    [400, 1, "long ago"],
    [0, 0, "today"],
    [-5, 0, "a date after the as-of date"],
  ])("last donation %s days ago -> %i (%s)", async (days, expected, _label) => {
    void _label;
    const row = await q1<{ ok: number }>(
      "SELECT fn_is_donor_eligible(IF(? IS NULL, NULL, DATE_SUB(CURDATE(), INTERVAL ? DAY)), CURDATE()) AS ok",
      [days, days],
    );
    expect(Number(row.ok)).toBe(expected);
  });
});

describe("Blood_Request triggers", () => {
  it("a new request always starts at 0 fulfilled / Pending, whatever the client sends", async () => {
    const hospitalId = await makeHospital();
    const recipientId = await makeRecipient(hospitalId);
    const [r] = await (await db()).query(
      "INSERT INTO Blood_Request (recipient_id, hospital_id, blood_group_needed, units_required, units_fulfilled, request_date, status) VALUES (?,?,?,?,?,CURDATE(),?)",
      [recipientId, hospitalId, "O+", 3, 3, "Fulfilled"],
    );
    expect(await requestState((r as { insertId: number }).insertId)).toEqual({ status: "Pending", units_required: 3, units_fulfilled: 0 });
  });

  it("rejects a request raised at a different hospital from the recipient's", async () => {
    const h1 = await makeHospital();
    const h2 = await makeHospital();
    const recipientId = await makeRecipient(h1);
    await expect(makeRequest(recipientId, h2)).rejects.toMatchObject(signal("REQUEST_HOSPITAL_MISMATCH"));
  });

  it("rejects a requested group the recipient cannot receive, allows a compatible different one", async () => {
    const hospitalId = await makeHospital();
    const recipientId = await makeRecipient(hospitalId, { blood_group: "A+" });
    await expect(makeRequest(recipientId, hospitalId, { blood_group_needed: "B+" })).rejects.toMatchObject(signal("REQUEST_GROUP_INCOMPATIBLE"));
    await expect(makeRequest(recipientId, hospitalId, { blood_group_needed: "O-" })).resolves.toBeGreaterThan(0);
  });

  it("status cannot be set by hand: it is always derived from the units", async () => {
    const { requestId } = await scenario();
    await (await db()).query("UPDATE Blood_Request SET status = 'Fulfilled' WHERE request_id = ?", [requestId]);
    expect((await requestState(requestId)).status).toBe("Pending");
  });

  it("lowering units_required to what was already donated completes the request; going lower is refused", async () => {
    const { hospitalId, requestId } = await scenario({ units: 3 });
    await donate(await makeDonor(), hospitalId, requestId);
    await expect((await db()).query("UPDATE Blood_Request SET units_required = 0 WHERE request_id = ?", [requestId])).rejects.toBeTruthy();
    await (await db()).query("UPDATE Blood_Request SET units_required = 1 WHERE request_id = ?", [requestId]);
    expect(await requestState(requestId)).toEqual({ status: "Fulfilled", units_required: 1, units_fulfilled: 1 });
  });

  it("a cancelled request cannot be reopened", async () => {
    const { requestId } = await scenario();
    await (await db()).query("UPDATE Blood_Request SET status = 'Cancelled' WHERE request_id = ?", [requestId]);
    await expect((await db()).query("UPDATE Blood_Request SET status = 'Pending' WHERE request_id = ?", [requestId])).rejects.toMatchObject(
      signal("REQUEST_CANCELLED"),
    );
    expect((await requestState(requestId)).status).toBe("Cancelled");
  });

  it("a fulfilled request cannot be cancelled", async () => {
    const { hospitalId, requestId } = await scenario({ units: 1 });
    await donate(await makeDonor(), hospitalId, requestId);
    await expect((await db()).query("UPDATE Blood_Request SET status = 'Cancelled' WHERE request_id = ?", [requestId])).rejects.toMatchObject(
      signal("REQUEST_ALREADY_FULFILLED"),
    );
  });
});

describe("Donation triggers", () => {
  it("partial then full fulfilment, and the donor's last_donation_date is set", async () => {
    const { hospitalId, requestId } = await scenario({ units: 2 });
    const d1 = await makeDonor();
    const d2 = await makeDonor();

    await donate(d1, hospitalId, requestId);
    expect(await requestState(requestId)).toEqual({ status: "Partially_Fulfilled", units_required: 2, units_fulfilled: 1 });

    await donate(d2, hospitalId, requestId);
    expect(await requestState(requestId)).toEqual({ status: "Fulfilled", units_required: 2, units_fulfilled: 2 });

    const donor = await q1<{ last: string; today: string }>("SELECT last_donation_date AS last, CURDATE() AS today FROM Donor WHERE donor_id = ?", [d1]);
    expect(donor.last).toBe(donor.today);
  });

  it("an older back-dated donation never moves last_donation_date backwards", async () => {
    const hospitalId = await makeHospital();
    const donorId = await makeDonor();
    const recent = await dbDaysAgo(10);
    await donate(donorId, hospitalId, null, 1, recent);
    await donate(donorId, hospitalId, null, 1, await dbDaysAgo(300));
    expect((await q1<{ d: string }>("SELECT last_donation_date AS d FROM Donor WHERE donor_id = ?", [donorId])).d).toBe(recent);
  });

  it("blocks over-fulfilment even for a raw INSERT that bypasses the application", async () => {
    const { hospitalId, requestId } = await scenario({ units: 1 });
    await expect(donate(await makeDonor(), hospitalId, requestId, 2)).rejects.toMatchObject(signal("OVER_FULFILLMENT"));
    expect(await requestState(requestId)).toEqual({ status: "Pending", units_required: 1, units_fulfilled: 0 });
    expect(Number((await q1<{ n: number }>("SELECT COUNT(*) AS n FROM Donation")).n)).toBe(0);
  });

  it("blocks a donation to a fulfilled request", async () => {
    const { hospitalId, requestId } = await scenario({ units: 1 });
    await donate(await makeDonor(), hospitalId, requestId);
    await expect(donate(await makeDonor(), hospitalId, requestId)).rejects.toMatchObject(signal("REQUEST_ALREADY_FULFILLED"));
  });

  it("blocks a donation to a cancelled request", async () => {
    const { hospitalId, requestId } = await scenario();
    await (await db()).query("UPDATE Blood_Request SET status = 'Cancelled' WHERE request_id = ?", [requestId]);
    await expect(donate(await makeDonor(), hospitalId, requestId)).rejects.toMatchObject(signal("REQUEST_CANCELLED"));
  });

  it("blocks an incompatible donor (A+ donor for an O+ request)", async () => {
    const { hospitalId, requestId } = await scenario({ group: "O+" });
    await expect(donate(await makeDonor({ blood_group: "A+" }), hospitalId, requestId)).rejects.toMatchObject(signal("DONOR_INCOMPATIBLE"));
  });

  it("blocks a donation recorded at a different hospital from the request's", async () => {
    const { requestId } = await scenario();
    const other = await makeHospital();
    await expect(donate(await makeDonor(), other, requestId)).rejects.toMatchObject(signal("DONATION_HOSPITAL_MISMATCH"));
  });

  it("donations cannot be edited", async () => {
    const hospitalId = await makeHospital();
    const id = await donate(await makeDonor(), hospitalId, null);
    await expect((await db()).query("UPDATE Donation SET units_donated = 2 WHERE donation_id = ?", [id])).rejects.toMatchObject(signal("DONATION_IMMUTABLE"));
  });

  it("deleting a donation reverses the fulfilment and the donor's date", async () => {
    const { hospitalId, requestId } = await scenario({ units: 1 });
    const donorId = await makeDonor();
    const earlier = await dbDaysAgo(200);
    await donate(donorId, hospitalId, null, 1, earlier);
    const id = await donate(donorId, hospitalId, requestId);
    expect((await requestState(requestId)).status).toBe("Fulfilled");

    await (await db()).query("DELETE FROM Donation WHERE donation_id = ?", [id]);
    expect(await requestState(requestId)).toEqual({ status: "Pending", units_required: 1, units_fulfilled: 0 });
    expect((await q1<{ d: string }>("SELECT last_donation_date AS d FROM Donor WHERE donor_id = ?", [donorId])).d).toBe(earlier);
  });
});

describe("views", () => {
  it("vw_request_queue lists only open requests, and sorts Critical > High > Medium > Low then oldest first", async () => {
    const hospitalId = await makeHospital();
    const recipientId = await makeRecipient(hospitalId);
    const low = await makeRequest(recipientId, hospitalId, { urgency_level: "Low", request_date: await dbDaysAgo(30) });
    const highNew = await makeRequest(recipientId, hospitalId, { urgency_level: "High", request_date: await dbDaysAgo(1) });
    const highOld = await makeRequest(recipientId, hospitalId, { urgency_level: "High", request_date: await dbDaysAgo(9) });
    const critical = await makeRequest(recipientId, hospitalId, { urgency_level: "Critical" });
    const medium = await makeRequest(recipientId, hospitalId, { urgency_level: "Medium" });
    const cancelled = await makeRequest(recipientId, hospitalId, { urgency_level: "Critical" });
    await (await db()).query("UPDATE Blood_Request SET status = 'Cancelled' WHERE request_id = ?", [cancelled]);
    const done = await makeRequest(recipientId, hospitalId, { urgency_level: "Critical", units_required: 1 });
    await donate(await makeDonor(), hospitalId, done);

    const queue = await q<{ request_id: number }>("SELECT request_id FROM vw_request_queue ORDER BY urgency_level, request_date, request_id");
    expect(queue.map((r) => r.request_id)).toEqual([critical, highOld, highNew, medium, low]);
  });

  it("vw_request_queue counts the donors who could give right now", async () => {
    const { requestId } = await scenario({ group: "A+" });
    await makeDonor({ blood_group: "A+" }); // counts
    await makeDonor({ blood_group: "O-" }); // counts (universal donor)
    await makeDonor({ blood_group: "B+" }); // incompatible
    await makeDonor({ blood_group: "A+", availability_status: "Unavailable" }); // unavailable
    await makeDonor({ blood_group: "A-", last_donation_date: await dbDaysAgo(20) }); // inside 90 days
    const row = await q1<{ n: number }>("SELECT eligible_donor_count AS n FROM vw_request_queue WHERE request_id = ?", [requestId]);
    expect(Number(row.n)).toBe(2);
  });

  it("vw_hospital_donation_stats aggregates donations and open requests per hospital", async () => {
    const { hospitalId, requestId } = await scenario({ units: 3 });
    const d1 = await makeDonor();
    await donate(d1, hospitalId, requestId, 2);
    await donate(d1, hospitalId, null, 1, await dbDaysAgo(200));
    await donate(await makeDonor(), hospitalId, null, 1, await dbDaysAgo(5));
    const empty = await makeHospital();

    const stats = await q1<Record<string, number>>("SELECT * FROM vw_hospital_donation_stats WHERE hospital_id = ?", [hospitalId]);
    expect(Number(stats.donation_count)).toBe(3);
    expect(Number(stats.units_collected)).toBe(4);
    expect(Number(stats.distinct_donors)).toBe(2);
    expect(Number(stats.open_requests)).toBe(1);
    expect(Number(stats.units_outstanding)).toBe(1);

    const none = await q1<Record<string, number>>("SELECT * FROM vw_hospital_donation_stats WHERE hospital_id = ?", [empty]);
    expect(Number(none.donation_count)).toBe(0); // hospitals with no donations still appear (LEFT JOIN)
    expect(Number(none.units_collected)).toBe(0);
  });

  it("vw_donor_eligibility explains why a donor can or cannot donate now", async () => {
    const never = await makeDonor();
    const recent = await makeDonor({ last_donation_date: await dbDaysAgo(30) });
    const off = await makeDonor({ availability_status: "Unavailable" });
    const rows = await q<{ donor_id: number; is_eligible: number; can_donate_now: number; next_eligible_date: string | null; days_since_last_donation: number | null }>(
      "SELECT * FROM vw_donor_eligibility",
    );
    const by = Object.fromEntries(rows.map((r) => [r.donor_id, r]));
    expect([by[never].is_eligible, by[never].can_donate_now, by[never].days_since_last_donation]).toEqual([1, 1, null]);
    expect([by[recent].is_eligible, by[recent].can_donate_now, by[recent].days_since_last_donation]).toEqual([0, 0, 30]);
    expect(by[recent].next_eligible_date).toBe((await q1<{ d: string }>("SELECT DATE_ADD(CURDATE(), INTERVAL 60 DAY) AS d")).d);
    expect([by[off].is_eligible, by[off].can_donate_now]).toEqual([1, 0]);
  });
});
