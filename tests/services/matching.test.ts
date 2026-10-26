import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool } from "@/lib/mysql";
import { closeMongo } from "@/lib/mongo";
import { cancelRequest, createRequest, listRequests, matchDonors, updateRequest } from "@/lib/services/requests";
import { listDonors, openRequestsForDonor } from "@/lib/services/donors";
import { closeAll, db, dbDaysAgo, makeDonor, makeHospital, makeRecipient, makeRequest, makeStaff, requestState, resetData, scenario } from "../helpers";

beforeEach(resetData);
afterAll(async () => {
  await closePool();
  await closeMongo();
  await closeAll();
});

describe("donor matching (sp_match_donors)", () => {
  it("returns only blood-group-compatible donors", async () => {
    const { requestId } = await scenario({ group: "A+" });
    const ok = [
      await makeDonor({ blood_group: "A+" }),
      await makeDonor({ blood_group: "A-" }),
      await makeDonor({ blood_group: "O+" }),
      await makeDonor({ blood_group: "O-" }),
    ];
    for (const g of ["B+", "B-", "AB+", "AB-"]) await makeDonor({ blood_group: g });

    const { matches } = await matchDonors(requestId);
    expect(matches.map((m) => m.donor_id).sort()).toEqual(ok.sort());
  });

  it("an O- request can only be served by O- donors", async () => {
    const { requestId } = await scenario({ group: "O-" });
    const oneg = await makeDonor({ blood_group: "O-" });
    for (const g of ["O+", "A-", "B-", "AB-", "A+", "B+", "AB+"]) await makeDonor({ blood_group: g });
    expect((await matchDonors(requestId)).matches.map((m) => m.donor_id)).toEqual([oneg]);
  });

  it("excludes donors marked Unavailable, always", async () => {
    const { requestId } = await scenario();
    const available = await makeDonor();
    await makeDonor({ availability_status: "Unavailable" });
    expect((await matchDonors(requestId)).matches.map((m) => m.donor_id)).toEqual([available]);
    expect((await matchDonors(requestId, true)).matches.map((m) => m.donor_id)).toEqual([available]);
  });

  it("applies the 90-day rule: 89 days is excluded, 90 days and 'never donated' are included", async () => {
    const { requestId } = await scenario();
    const never = await makeDonor();
    const d90 = await makeDonor({ last_donation_date: await dbDaysAgo(90) });
    const d89 = await makeDonor({ last_donation_date: await dbDaysAgo(89) });

    const strict = await matchDonors(requestId);
    expect(strict.matches.map((m) => m.donor_id).sort()).toEqual([never, d90].sort());

    const all = await matchDonors(requestId, true);
    const waiting = all.matches.find((m) => m.donor_id === d89)!;
    expect(Number(waiting.is_eligible)).toBe(0);
    expect(waiting.days_since_last_donation).toBe(89);
    expect(waiting.next_eligible_date).toBe(await dbDaysAgo(-1)); // eligible tomorrow
    expect(all.summary).toEqual({ eligible: 2, listed: 3, units_remaining: 2 });
  });

  it("handles a missing donation date explicitly (NULL, not an error, treated as eligible)", async () => {
    const { requestId } = await scenario();
    await makeDonor({ last_donation_date: null });
    const [m] = (await matchDonors(requestId)).matches;
    expect(m.last_donation_date).toBeNull();
    expect(m.days_since_last_donation).toBeNull();
    expect(m.next_eligible_date).toBeNull();
    expect(Number(m.is_eligible)).toBe(1);
  });

  it("ranks: eligible first, exact group, same city as the hospital, then longest since last donation", async () => {
    const { requestId } = await scenario({ group: "A+", city: "Mysuru" });
    const ineligibleExact = await makeDonor({ blood_group: "A+", city: "Mysuru", last_donation_date: await dbDaysAgo(5) });
    const otherGroupSameCity = await makeDonor({ blood_group: "O+", city: "Mysuru" });
    const exactOtherCity = await makeDonor({ blood_group: "A+", city: "Bengaluru" });
    const exactSameCityRecent = await makeDonor({ blood_group: "A+", city: "Mysuru", last_donation_date: await dbDaysAgo(100) });
    const exactSameCityOld = await makeDonor({ blood_group: "A+", city: "Mysuru", last_donation_date: await dbDaysAgo(400) });
    const exactSameCityNever = await makeDonor({ blood_group: "A+", city: "Mysuru" });

    const { matches } = await matchDonors(requestId, true);
    expect(matches.map((m) => m.donor_id)).toEqual([
      exactSameCityNever,
      exactSameCityOld,
      exactSameCityRecent,
      exactOtherCity,
      otherGroupSameCity,
      ineligibleExact,
    ]);
  });

  it("reports clearly when nobody matches", async () => {
    const { requestId } = await scenario({ group: "O-" });
    await makeDonor({ blood_group: "A+" });
    const result = await matchDonors(requestId);
    expect(result.matches).toEqual([]);
    expect(result.message).toMatch(/No compatible donor/);
  });

  it("explains when compatible donors exist but are all inside the waiting period", async () => {
    const { requestId } = await scenario();
    await makeDonor({ last_donation_date: await dbDaysAgo(10) });
    expect((await matchDonors(requestId)).matches).toEqual([]);
    const all = await matchDonors(requestId, true);
    expect(all.matches).toHaveLength(1);
    expect(all.message).toMatch(/within 90 days/);
  });

  it("warns when there are fewer eligible donors than units still needed", async () => {
    const { requestId } = await scenario({ units: 3 });
    await makeDonor();
    expect((await matchDonors(requestId)).message).toMatch(/Only 1 eligible donor/);
  });

  it("does not match donors for a cancelled request", async () => {
    const { requestId, staff } = await scenario();
    await makeDonor();
    await cancelRequest(staff, requestId);
    const result = await matchDonors(requestId);
    expect(result.matches).toEqual([]);
    expect(result.message).toMatch(/cancelled/);
  });

  it("a missing request is a 404", async () => {
    await expect(matchDonors(424242)).rejects.toMatchObject({ status: 404 });
  });
});

describe("request management", () => {
  it("creates a request defaulting to the recipient's blood group, at the staff member's hospital", async () => {
    const hospitalId = await makeHospital();
    const staff = await makeStaff(hospitalId);
    const recipientId = await makeRecipient(hospitalId, { blood_group: "B-" });
    const { request } = await createRequest(staff, { recipient_id: recipientId, units_required: 2, urgency_level: "High", notes: null });
    expect(request).toMatchObject({ blood_group_needed: "B-", hospital_id: hospitalId, status: "Pending", units_fulfilled: 0, urgency_level: "High" });
  });

  it("staff cannot raise a request for another hospital's recipient", async () => {
    const mine = await makeHospital();
    const theirs = await makeHospital();
    const staff = await makeStaff(mine);
    const recipientId = await makeRecipient(theirs);
    await expect(createRequest(staff, { recipient_id: recipientId, units_required: 1, urgency_level: "Low", notes: null })).rejects.toMatchObject({ status: 403 });
  });

  it("lists open requests by urgency then age, and can list everything", async () => {
    const hospitalId = await makeHospital();
    const staff = await makeStaff(hospitalId);
    const recipientId = await makeRecipient(hospitalId);
    const medium = await makeRequest(recipientId, hospitalId, { urgency_level: "Medium" });
    const critical = await makeRequest(recipientId, hospitalId, { urgency_level: "Critical" });
    const low = await makeRequest(recipientId, hospitalId, { urgency_level: "Low" });
    const highOld = await makeRequest(recipientId, hospitalId, { urgency_level: "High", request_date: await dbDaysAgo(4) });
    const highNew = await makeRequest(recipientId, hospitalId, { urgency_level: "High" });
    const cancelled = await makeRequest(recipientId, hospitalId, { urgency_level: "Critical" });
    await cancelRequest(staff, cancelled);

    expect((await listRequests()).map((r) => r.request_id)).toEqual([critical, highOld, highNew, medium, low]);
    expect((await listRequests({ status: "all" })).map((r) => r.request_id)).toEqual([critical, highOld, highNew, medium, low, cancelled]);
    expect((await listRequests({ status: "Cancelled" })).map((r) => r.request_id)).toEqual([cancelled]);
    expect((await listRequests({ urgency: "High" })).map((r) => r.request_id)).toEqual([highOld, highNew]);
  });

  it("cancelling: works once, cannot be repeated, edited or fulfilled afterwards", async () => {
    const { requestId, staff } = await scenario();
    const { request } = await cancelRequest(staff, requestId, "patient transferred");
    expect(request.status).toBe("Cancelled");
    await expect(cancelRequest(staff, requestId)).rejects.toMatchObject({ status: 409, code: "REQUEST_CANCELLED" });
    await expect(updateRequest(staff, requestId, { urgency_level: "Critical" })).rejects.toMatchObject({ status: 409 });
    expect((await requestState(requestId)).status).toBe("Cancelled");
  });

  it("another hospital's staff cannot cancel or edit the request", async () => {
    const { requestId } = await scenario();
    const outsider = await makeStaff(await makeHospital());
    await expect(cancelRequest(outsider, requestId)).rejects.toMatchObject({ status: 403 });
    await expect(updateRequest(outsider, requestId, { units_required: 5 })).rejects.toMatchObject({ status: 403 });
  });

  it("units_required cannot be edited below what has been donated", async () => {
    const { requestId, staff, hospitalId } = await scenario({ units: 3 });
    for (let i = 0; i < 2; i++) {
      await (await db()).query("INSERT INTO Donation (donor_id, hospital_id, request_id, donation_date, units_donated) VALUES (?,?,?,CURDATE(),1)", [
        await makeDonor(),
        hospitalId,
        requestId,
      ]);
    }
    await expect(updateRequest(staff, requestId, { units_required: 1 })).rejects.toMatchObject({ status: 409, code: "UNITS_BELOW_FULFILLED" });
    const { request } = await updateRequest(staff, requestId, { units_required: 2 });
    expect(request.status).toBe("Fulfilled");
  });
});

describe("donor search and reverse matching", () => {
  it("full-text search over name and city, with a LIKE fallback for short terms", async () => {
    await makeDonor({ name: "Charulata Banerjee", city: "Hubballi" });
    await makeDonor({ name: "Devika Menon", city: "Mysuru" });
    await makeDonor({ name: "Li Na", city: "Udupi" });

    const ft = await listDonors({ q: "charu" });
    expect(ft.search).toBe("full-text");
    expect(ft.items.map((d) => d.name)).toEqual(["Charulata Banerjee"]);

    expect((await listDonors({ q: "mysuru" })).items.map((d) => d.name)).toEqual(["Devika Menon"]);
    expect((await listDonors({ q: "devika mysuru" })).items).toHaveLength(1);
    expect((await listDonors({ q: "devika hubballi" })).items).toHaveLength(0);

    const short = await listDonors({ q: "Li" });
    expect(short.search).toBe("like");
    // "li" also occurs in the city "Hubballi"
    expect(short.items.map((d) => d.name).sort()).toEqual(["Charulata Banerjee", "Li Na"]);
  });

  it("search input cannot inject SQL or break the query", async () => {
    await makeDonor({ name: "Normal Person" });
    for (const q of ["'; DROP TABLE Donor; --", '+"*(~<>@', "%' OR '1'='1"]) {
      await expect(listDonors({ q })).resolves.toBeTruthy();
    }
    expect((await listDonors()).items).toHaveLength(1);
  });

  it("filters by blood group, availability and readiness", async () => {
    await makeDonor({ blood_group: "A+" });
    await makeDonor({ blood_group: "A+", availability_status: "Unavailable" });
    await makeDonor({ blood_group: "B+", last_donation_date: await dbDaysAgo(3) });
    expect((await listDonors({ blood_group: "A+" })).items).toHaveLength(2);
    expect((await listDonors({ availability: "Unavailable" })).items).toHaveLength(1);
    expect((await listDonors({ ready: "yes" })).items).toHaveLength(1);
    expect((await listDonors({ ready: "no" })).items).toHaveLength(2);
  });

  it("shows a donor the open requests their blood group can help, most urgent first", async () => {
    const hospitalId = await makeHospital();
    const rA = await makeRecipient(hospitalId, { blood_group: "A+" });
    const rB = await makeRecipient(hospitalId, { blood_group: "B+" });
    const low = await makeRequest(rA, hospitalId, { blood_group_needed: "A+", urgency_level: "Low" });
    const critical = await makeRequest(rA, hospitalId, { blood_group_needed: "A+", urgency_level: "Critical" });
    await makeRequest(rB, hospitalId, { blood_group_needed: "B+", urgency_level: "Critical" });
    const donorId = await makeDonor({ blood_group: "A-" });
    expect((await openRequestsForDonor(donorId)).map((r) => (r as { request_id: number }).request_id)).toEqual([critical, low]);
  });
});
