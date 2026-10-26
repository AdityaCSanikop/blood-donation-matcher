/**
 * HTTP-level tests: real server, real MySQL, real MongoDB.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeAll, logs, makeDonor, makeDonorUser, makeHospital, makeRecipient, makeStaff, q1, resetData, TEST_PASSWORD } from "../helpers";

const BASE = "http://127.0.0.1:3101";

type Json = { data?: any; meta?: any; error?: { code: string; message: string; fields?: Record<string, string> } }; // eslint-disable-line @typescript-eslint/no-explicit-any

class Client {
  cookie = "";
  async call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Json; headers: Headers }> {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      redirect: "manual",
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    let json: Json = {};
    try {
      json = await res.json();
    } catch {}
    return { status: res.status, json, headers: res.headers };
  }
  get = (p: string) => this.call("GET", p);
  post = (p: string, b?: unknown) => this.call("POST", p, b);
  patch = (p: string, b?: unknown) => this.call("PATCH", p, b);
  del = (p: string) => this.call("DELETE", p);
  async login(email: string, password = TEST_PASSWORD) {
    return this.post("/api/auth/login", { email, password });
  }
}

let hospitalId: number;
let otherHospitalId: number;
const staff = new Client();
const otherStaff = new Client();
const donor = new Client();
let donorId: number;

beforeAll(async () => {
  await resetData();
  hospitalId = await makeHospital({ name: "API General", city: "Bengaluru" });
  otherHospitalId = await makeHospital({ name: "API Other", city: "Mysuru" });
  await makeStaff(hospitalId, "staff@api.test");
  await makeStaff(otherHospitalId, "other@api.test");
  donorId = await makeDonor({ blood_group: "O-", name: "Api Donor" });
  await makeDonorUser(donorId, "donor@api.test");
  expect((await staff.login("staff@api.test")).status).toBe(200);
  expect((await otherStaff.login("other@api.test")).status).toBe(200);
  expect((await donor.login("donor@api.test")).status).toBe(200);
});
afterAll(closeAll);

describe("health", () => {
  it("reports both databases up", async () => {
    const res = await new Client().get("/api/health");
    expect(res.status).toBe(200);
    expect(res.json.data).toEqual({ mysql: "up", mongodb: "up" });
  });
});

describe("authentication", () => {
  it("rejects wrong passwords and unknown emails with the same message", async () => {
    const a = await new Client().login("staff@api.test", "wrong-password");
    const b = await new Client().login("nobody@api.test", "whatever123");
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.json.error?.message).toBe(b.json.error?.message);
  });

  it("sets an httpOnly, SameSite session cookie and never returns the password hash", async () => {
    const c = new Client();
    const res = await c.login("staff@api.test");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/bdm_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(JSON.stringify(res.json)).not.toMatch(/password|\$2[aby]\$/);
    expect(res.json.data).toMatchObject({ role: "STAFF", hospital_id: hospitalId });
  });

  it("every data endpoint answers 401 without a session", async () => {
    const anon = new Client();
    for (const path of ["/api/stats", "/api/donors", "/api/hospitals", "/api/recipients", "/api/requests", "/api/donations", "/api/activity", "/api/activity/stats", "/api/auth/me"]) {
      expect((await anon.get(path)).status, path).toBe(401);
    }
    expect((await anon.post("/api/donations", { donor_id: 1 })).status).toBe(401);
    expect((await anon.post("/api/activity/reconcile")).status).toBe(401);
  });

  it("a tampered session token is rejected", async () => {
    const c = new Client();
    c.cookie = staff.cookie.slice(0, -4) + "AAAA";
    expect((await c.get("/api/stats")).status).toBe(401);
  });

  it("logout clears the session", async () => {
    const c = new Client();
    await c.login("staff@api.test");
    expect((await c.get("/api/auth/me")).status).toBe(200);
    await c.post("/api/auth/logout");
    c.cookie = "bdm_session=";
    expect((await c.get("/api/auth/me")).status).toBe(401);
  });

  it("stores passwords only as bcrypt hashes", async () => {
    const row = await q1<{ password_hash: string }>("SELECT password_hash FROM App_User WHERE email = 'staff@api.test'");
    expect(row.password_hash).toMatch(/^\$2[aby]\$\d\d\$.{53}$/);
    expect(row.password_hash).not.toContain(TEST_PASSWORD);
  });
});

describe("authorization (two roles)", () => {
  it("a donor is forbidden from every staff endpoint", async () => {
    for (const path of ["/api/stats", "/api/donors", "/api/hospitals", "/api/recipients", "/api/requests", "/api/donations", "/api/activity/stats"]) {
      expect((await donor.get(path)).status, path).toBe(403);
    }
    expect((await donor.post("/api/requests", { recipient_id: 1, units_required: 1 })).status).toBe(403);
    expect((await donor.post("/api/donations", { donor_id: donorId, units_donated: 1 })).status).toBe(403);
    expect((await donor.post("/api/activity/reconcile")).status).toBe(403);
  });

  it("a donor can read and update only their own record", async () => {
    const other = await makeDonor();
    expect((await donor.get(`/api/donors/${donorId}`)).status).toBe(200);
    expect((await donor.get(`/api/donors/${other}`)).status).toBe(403);
    expect((await donor.patch(`/api/donors/${other}/availability`, { availability_status: "Unavailable" })).status).toBe(403);
    expect((await donor.del(`/api/donors/${donorId}`)).status).toBe(403);
  });
});

describe("validation", () => {
  it("returns 422 with per-field messages for a bad donor", async () => {
    const res = await staff.post("/api/donors", { name: "X", blood_group: "Z+", phone: "abc", city: "" });
    expect(res.status).toBe(422);
    expect(res.json.error?.code).toBe("VALIDATION");
    expect(Object.keys(res.json.error?.fields ?? {}).sort()).toEqual(["blood_group", "city", "name", "phone"]);
  });

  it("rejects malformed JSON, bad ids and unknown filters with 400", async () => {
    expect((await staff.post("/api/donors", "{not json")).status).toBe(400);
    expect((await staff.get("/api/requests/abc")).status).toBe(400);
    expect((await staff.get("/api/donors?blood_group=Q")).status).toBe(400);
    expect((await staff.get("/api/activity/stats?granularity=month")).status).toBe(400);
  });

  it("rejects impossible dates, future dates and out-of-range units", async () => {
    const a = await staff.post("/api/donors", { name: "Date Test", blood_group: "A+", phone: "9555000001", city: "Mysuru", last_donation_date: "2026-02-31" });
    expect(a.status).toBe(422);
    const b = await staff.post("/api/donors", { name: "Date Test", blood_group: "A+", phone: "9555000001", city: "Mysuru", last_donation_date: "2999-01-01" });
    expect(b.status).toBe(422);
    const c = await staff.post("/api/donations", { donor_id: donorId, units_donated: 3 });
    expect(c.status).toBe(422);
    expect(c.json.error?.fields?.units_donated).toBeTruthy();
  });

  it("a duplicate phone number is a 409 with a clear message", async () => {
    const body = { name: "First Person", blood_group: "B+", phone: "9555000002", city: "Mysuru" };
    expect((await staff.post("/api/donors", body)).status).toBe(201);
    const dup = await staff.post("/api/donors", { ...body, name: "Second Person" });
    expect(dup.status).toBe(409);
    expect(dup.json.error?.message).toMatch(/phone number is already registered/);
  });

  it("404 for records that do not exist", async () => {
    expect((await staff.get("/api/requests/987654")).status).toBe(404);
    expect((await staff.get("/api/requests/987654/matches")).status).toBe(404);
    expect((await staff.del("/api/donations/987654")).status).toBe(404);
  });
});

describe("end-to-end workflow over the API", () => {
  let recipientId: number;
  let requestId: number;
  let donorA: number;
  let donorB: number;

  it("staff registers a recipient at their own hospital", async () => {
    const res = await staff.post("/api/recipients", { name: "Workflow Patient", blood_group: "A+", age: 44, hospital_id: otherHospitalId });
    expect(res.status).toBe(201);
    expect(res.json.data.hospital_id).toBe(hospitalId); // a hospital_id in the body is ignored
    recipientId = res.json.data.recipient_id;
  });

  it("staff registers donors", async () => {
    const a = await staff.post("/api/donors", { name: "Workflow Alpha", blood_group: "A+", phone: "9555000011", city: "Bengaluru" });
    const b = await staff.post("/api/donors", { name: "Workflow Beta", blood_group: "O+", phone: "9555000012", city: "Mysuru" });
    expect([a.status, b.status]).toEqual([201, 201]);
    donorA = a.json.data.donor_id;
    donorB = b.json.data.donor_id;
    expect(a.json.meta.activity_log).toBe("delivered");
  });

  it("staff raises a request; it starts Pending with 0 fulfilled", async () => {
    const res = await staff.post("/api/requests", { recipient_id: recipientId, units_required: 2, urgency_level: "Critical", units_fulfilled: 2, status: "Fulfilled" });
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({ status: "Pending", units_fulfilled: 0, units_required: 2, blood_group_needed: "A+", urgency_level: "Critical" });
    requestId = res.json.data.request_id;
  });

  it("another hospital cannot raise a request for this recipient", async () => {
    expect((await otherStaff.post("/api/requests", { recipient_id: recipientId, units_required: 1 })).status).toBe(403);
  });

  it("the request tops the open queue", async () => {
    const res = await staff.get("/api/requests");
    expect(res.json.data[0].request_id).toBe(requestId);
  });

  it("matching ranks the exact-group, same-city donor first and carries the disclaimer", async () => {
    const res = await staff.get(`/api/requests/${requestId}/matches`);
    expect(res.status).toBe(200);
    const ids = res.json.data.matches.map((m: { donor_id: number }) => m.donor_id);
    expect(ids[0]).toBe(donorA);
    expect(ids).toContain(donorB);
    expect(ids).toContain(donorId); // O- universal donor
    expect(res.json.meta.disclaimer).toMatch(/not clinical approval/);
  });

  it("a donor who switches to unavailable disappears from the matches", async () => {
    const off = await donor.patch(`/api/donors/${donorId}/availability`, { availability_status: "Unavailable" });
    expect(off.status).toBe(200);
    expect(off.json.meta).toMatchObject({ changed: true, activity_log: "delivered" });
    const res = await staff.get(`/api/requests/${requestId}/matches`);
    expect(res.json.data.matches.map((m: { donor_id: number }) => m.donor_id)).not.toContain(donorId);
  });

  it("another hospital's staff cannot record a donation for this request", async () => {
    const res = await otherStaff.post("/api/donations", { donor_id: donorA, request_id: requestId, units_donated: 1 });
    expect(res.status).toBe(403);
  });

  it("first donation -> Partially_Fulfilled", async () => {
    const res = await staff.post("/api/donations", { donor_id: donorA, request_id: requestId, units_donated: 1 });
    expect(res.status).toBe(201);
    expect(res.json.data.request).toMatchObject({ status: "Partially_Fulfilled", units_fulfilled: 1, units_remaining: 1 });
  });

  it("the same donor cannot donate again (90-day rule) and over-fulfilment is refused", async () => {
    const again = await staff.post("/api/donations", { donor_id: donorA, request_id: requestId, units_donated: 1 });
    expect(again.status).toBe(409);
    expect(again.json.error?.code).toBe("DONOR_NOT_ELIGIBLE");
    const tooMuch = await staff.post("/api/donations", { donor_id: donorB, request_id: requestId, units_donated: 2 });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.json.error?.code).toBe("OVER_FULFILLMENT");
  });

  it("second donation -> Fulfilled; further donations and cancellation are refused", async () => {
    const res = await staff.post("/api/donations", { donor_id: donorB, request_id: requestId, units_donated: 1 });
    expect(res.status).toBe(201);
    expect(res.json.data.request).toMatchObject({ status: "Fulfilled", units_remaining: 0 });

    const extra = await makeDonor({ blood_group: "A+" });
    const more = await staff.post("/api/donations", { donor_id: extra, request_id: requestId, units_donated: 1 });
    expect(more.status).toBe(409);
    expect(more.json.error?.code).toBe("REQUEST_ALREADY_FULFILLED");
    expect((await staff.post(`/api/requests/${requestId}/cancel`, {})).status).toBe(409);
  });

  it("matching a closed request returns an explanation instead of donors", async () => {
    const res = await staff.get(`/api/requests/${requestId}/matches`);
    expect(res.json.data.matches).toEqual([]);
    expect(res.json.data.message).toMatch(/fulfilled/);
  });

  it("a cancelled request refuses donations", async () => {
    const created = await staff.post("/api/requests", { recipient_id: recipientId, units_required: 1, urgency_level: "Low" });
    const id = created.json.data.request_id;
    const cancelled = await staff.post(`/api/requests/${id}/cancel`, { reason: "duplicate entry" });
    expect(cancelled.json.data.status).toBe("Cancelled");
    const d = await makeDonor({ blood_group: "A+" });
    const res = await staff.post("/api/donations", { donor_id: d, request_id: id, units_donated: 1 });
    expect(res.status).toBe(409);
    expect(res.json.error?.code).toBe("REQUEST_CANCELLED");
  });

  it("the dashboard reflects the donations (hospital-wise statistics)", async () => {
    const res = await staff.get("/api/stats");
    expect(res.status).toBe(200);
    const mine = res.json.data.hospitals.find((h: { hospital_id: number }) => h.hospital_id === hospitalId);
    expect(mine).toMatchObject({ donation_count: 2, units_collected: 2, distinct_donors: 2, open_requests: 0 });
    expect(res.json.data.blood_groups).toHaveLength(8);
  });

  it("the activity log has the whole story for the request, newest first", async () => {
    const res = await staff.get(`/api/activity?request_id=${requestId}`);
    expect(res.status).toBe(200);
    expect(res.json.data.map((e: { action: string }) => e.action)).toEqual([
      "request_status_changed",
      "donation_recorded",
      "request_status_changed",
      "donation_recorded",
      "request_created",
    ]);
    expect(res.json.meta.pending_delivery).toBe(0);
    expect(res.json.data[0].details).toMatchObject({ old_status: "Partially_Fulfilled", new_status: "Fulfilled" });
  });

  it("activity statistics come from the aggregation pipeline", async () => {
    const res = await staff.get("/api/activity/stats?granularity=week&days=7");
    expect(res.status).toBe(200);
    expect(res.json.data.granularity).toBe("week");
    expect(res.json.data.by_period[0].period).toMatch(/^\d{4}-W\d{2}$/);
    const total = await (await logs()).countDocuments();
    expect(res.json.data.total).toBe(total);
    const recorded = res.json.data.by_action.find((a: { action: string }) => a.action === "donation_recorded");
    expect(recorded.count).toBe(2);
  });

  it("a donor sees only activity about themself", async () => {
    const res = await donor.get("/api/activity?donor_id=" + donorA); // tries to read someone else's
    expect(res.status).toBe(200);
    expect(res.json.data.length).toBeGreaterThan(0);
    for (const e of res.json.data) expect(e.related.donor_id).toBe(donorId);
  });

  it("deleting a donation reopens the request; deleting referenced records is refused", async () => {
    const list = await staff.get(`/api/donations?request_id=${requestId}`);
    const donationId = list.json.data[0].donation_id;
    expect((await otherStaff.del(`/api/donations/${donationId}`)).status).toBe(403);
    expect((await staff.del(`/api/donations/${donationId}`)).status).toBe(200);
    expect((await staff.get(`/api/requests/${requestId}`)).json.data).toMatchObject({ status: "Partially_Fulfilled", units_fulfilled: 1 });

    const blocked = await staff.del(`/api/donors/${donorA}`);
    expect(blocked.status).toBe(409);
    expect(blocked.json.error?.code).toBe("IN_USE");
    expect((await staff.del(`/api/hospitals/${hospitalId}`)).status).toBe(409);
  });
});

describe("donor self-registration", () => {
  it("creates the donor, the login and a log entry in one step, then signs in", async () => {
    const c = new Client();
    const res = await c.post("/api/auth/register", {
      name: "Self Registered",
      email: "Self@Api.Test",
      password: "Sup3rSecret!",
      blood_group: "AB-",
      phone: "9555000099",
      city: "Udupi",
    });
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({ role: "DONOR", email: "self@api.test" });
    const me = await c.get("/api/auth/me");
    expect(me.status).toBe(200);
    const mine = await c.get(`/api/donors/${me.json.data.donor_id}`);
    expect(mine.json.data).toMatchObject({ blood_group: "AB-", can_donate_now: 1 });
    const log = await (await logs()).findOne({ action: "donor_registered", "details.registered_by": "self" });
    expect(log?.entity_id).toBe(me.json.data.donor_id);
  });

  it("if the email is taken, no orphan donor row is left behind (transaction)", async () => {
    const before = Number((await q1<{ n: number }>("SELECT COUNT(*) AS n FROM Donor")).n);
    const res = await new Client().post("/api/auth/register", {
      name: "Clash Person",
      email: "self@api.test",
      password: "Sup3rSecret!",
      blood_group: "A+",
      phone: "9555000098",
      city: "Udupi",
    });
    expect(res.status).toBe(409);
    expect(Number((await q1<{ n: number }>("SELECT COUNT(*) AS n FROM Donor")).n)).toBe(before);
  });

  it("weak passwords are rejected", async () => {
    const res = await new Client().post("/api/auth/register", { name: "Weak Pw", email: "weak@api.test", password: "short", blood_group: "A+", phone: "9555000097", city: "Udupi" });
    expect(res.status).toBe(422);
    expect(res.json.error?.fields?.password).toBeTruthy();
  });
});

describe("hospital management", () => {
  it("registers a hospital with its first staff login, who can then sign in", async () => {
    const res = await staff.post("/api/hospitals", {
      name: "Brand New Clinic",
      city: "Hubballi",
      phone: "08361234567",
      first_staff: { display_name: "New Admin", email: "admin@newclinic.test", password: "FirstLogin#1" },
    });
    expect(res.status).toBe(201);
    const c = new Client();
    const login = await c.login("admin@newclinic.test", "FirstLogin#1");
    expect(login.status).toBe(200);
    expect(login.json.data.hospital_id).toBe(res.json.data.hospital_id);
  });

  it("duplicate hospital name in the same city is refused; staff can edit only their own hospital", async () => {
    const dup = await staff.post("/api/hospitals", { name: "API General", city: "Bengaluru", phone: "08012345678" });
    expect(dup.status).toBe(409);
    expect((await staff.patch(`/api/hospitals/${otherHospitalId}`, { phone: "08099999999" })).status).toBe(403);
    const mine = await staff.patch(`/api/hospitals/${hospitalId}`, { phone: "08099999999" });
    expect(mine.status).toBe(200);
    expect(mine.json.data.phone).toBe("08099999999");
  });

  it("search filters hospitals", async () => {
    const res = await staff.get("/api/hospitals?q=Hubballi");
    expect(res.json.data.map((h: { name: string }) => h.name)).toEqual(["Brand New Clinic"]);
  });
});

void makeRecipient;
