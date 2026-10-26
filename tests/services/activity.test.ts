import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { activityStats, findActivity, flushOutbox, pendingCount } from "@/lib/activity";
import { closePool } from "@/lib/mysql";
import { closeMongo, getActivityCollection } from "@/lib/mongo";
import { setAvailability } from "@/lib/services/donors";
import { recordDonation } from "@/lib/services/donations";
import { cancelRequest, createRequest } from "@/lib/services/requests";
import { closeAll, db, logs, makeDonor, makeDonorUser, makeHospital, makeRecipient, makeStaff, q, q1, resetData, scenario } from "../helpers";

const REAL_URI = process.env.MONGODB_URI!;
process.env.MONGODB_URI_REAL = REAL_URI;

beforeEach(async () => {
  process.env.MONGODB_URI = REAL_URI;
  await resetData();
});
afterAll(async () => {
  process.env.MONGODB_URI = REAL_URI;
  await closePool();
  await closeMongo();
  await closeAll();
});

describe("events written to MongoDB activity_logs", () => {
  it("donor availability change records old and new status and who did it", async () => {
    const donorId = await makeDonor();
    const donorUser = await makeDonorUser(donorId);
    const result = await setAvailability(donorUser, donorId, "Unavailable");
    expect(result).toMatchObject({ changed: true, activity_log: "delivered" });

    const docs = await (await logs()).find({ entity_type: "donor", entity_id: donorId }).toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      action: "donor_availability_changed",
      details: { old_status: "Available", new_status: "Unavailable" },
      performed_by: { user_id: donorUser.user_id, role: "DONOR" },
      related: { donor_id: donorId },
    });
    expect(docs[0].timestamp).toBeInstanceOf(Date);
  });

  it("setting the same availability again changes nothing and logs nothing", async () => {
    const donorId = await makeDonor();
    const staff = await makeStaff(await makeHospital());
    const result = await setAvailability(staff, donorId, "Available");
    expect(result.changed).toBe(false);
    expect(await (await logs()).countDocuments()).toBe(0);
  });

  it("a donor cannot change another donor's availability", async () => {
    const mine = await makeDonor();
    const other = await makeDonor();
    await expect(setAvailability(await makeDonorUser(mine), other, "Unavailable")).rejects.toMatchObject({ status: 403 });
  });

  it("request creation, donation and each status change are logged with differently shaped details", async () => {
    const hospitalId = await makeHospital();
    const staff = await makeStaff(hospitalId);
    const recipientId = await makeRecipient(hospitalId, { blood_group: "A+" });
    const { request } = await createRequest(staff, { recipient_id: recipientId, units_required: 2, urgency_level: "Critical", notes: null });
    await recordDonation(staff, { donor_id: await makeDonor({ blood_group: "A+" }), request_id: request.request_id, units_donated: 1, donation_date: null });
    await cancelRequest(staff, request.request_id, "no longer needed");

    const docs = await (await logs()).find({ "related.request_id": request.request_id }).sort({ timestamp: 1 }).toArray();
    expect(docs.map((d) => d.action)).toEqual(["request_created", "donation_recorded", "request_status_changed", "request_status_changed"]);
    expect(docs[0].details).toEqual({ blood_group: "A+", units_required: 2, urgency: "Critical" });
    expect(docs[1].details).toMatchObject({ units_donated: 1, walk_in: false });
    expect(docs[2].details).toMatchObject({ old_status: "Pending", new_status: "Partially_Fulfilled", reason: "donation recorded" });
    expect(docs[3].details).toMatchObject({ old_status: "Partially_Fulfilled", new_status: "Cancelled", reason: "no longer needed" });
  });

  it("a rejected operation writes no log entry", async () => {
    const { staff, requestId } = await scenario({ units: 1 });
    await expect(recordDonation(staff, { donor_id: await makeDonor(), request_id: requestId, units_donated: 2, donation_date: null })).rejects.toBeTruthy();
    expect(await (await logs()).countDocuments()).toBe(0);
    expect(await pendingCount()).toBe(0);
  });
});

describe("collection design", () => {
  it("creates the designed indexes", async () => {
    const names = (await (await getActivityCollection()).indexes()).map((i) => i.name);
    for (const n of ["uq_event_id", "idx_entity_history", "idx_timestamp", "idx_action_time", "idx_related_donor", "idx_related_request"]) {
      expect(names).toContain(n);
    }
  });

  it("the entity-history query uses its compound index (no collection scan)", async () => {
    const donorId = await makeDonor();
    await setAvailability(await makeStaff(await makeHospital()), donorId, "Unavailable");
    const plan = await (await getActivityCollection()).find({ entity_type: "donor", entity_id: donorId }).sort({ timestamp: -1 }).explain("queryPlanner");
    const text = JSON.stringify(plan);
    expect(text).toContain("idx_entity_history");
    expect(text).not.toContain("COLLSCAN");
  });

  it("the JSON-schema validator rejects malformed documents", async () => {
    const coll = await getActivityCollection();
    await expect(coll.insertOne({ event_id: "x", action: "missing-fields" } as never)).rejects.toBeTruthy();
    await expect(
      coll.insertOne({ event_id: "y", entity_type: "spaceship", entity_id: 1, action: "a", timestamp: new Date(), details: {}, performed_by: {} } as never),
    ).rejects.toBeTruthy();
  });
});

describe("history retrieval", () => {
  it("returns newest first, filters by entity and paginates", async () => {
    const staff = await makeStaff(await makeHospital());
    const a = await makeDonor();
    const b = await makeDonor();
    await setAvailability(staff, a, "Unavailable");
    await setAvailability(staff, b, "Unavailable");
    await setAvailability(staff, a, "Available");

    const forA = await findActivity({ entity_type: "donor", entity_id: a });
    expect(forA.total).toBe(2);
    expect(forA.items.map((i) => i.details.new_status)).toEqual(["Available", "Unavailable"]);
    expect(forA.items[0]).not.toHaveProperty("_id");

    const page = await findActivity({ limit: 1, skip: 1 });
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(1);
  });

  it("related.donor_id finds everything that touched a donor, across entity types", async () => {
    const { staff, requestId } = await scenario();
    const donorId = await makeDonor();
    await setAvailability(staff, donorId, "Unavailable");
    await setAvailability(staff, donorId, "Available");
    await recordDonation(staff, { donor_id: donorId, request_id: requestId, units_donated: 1, donation_date: null });
    const { items } = await findActivity({ donor_id: donorId });
    expect(items.map((i) => i.entity_type).sort()).toEqual(["donation", "donor", "donor", "request"]);
  });
});

describe("MySQL -> MongoDB consistency (outbox)", () => {
  it("every committed change has exactly one delivered outbox row and one document", async () => {
    const { staff, requestId } = await scenario();
    await recordDonation(staff, { donor_id: await makeDonor(), request_id: requestId, units_donated: 1, donation_date: null });
    const outbox = await q<{ event_id: string; delivered_at: string | null }>("SELECT event_id, delivered_at FROM Activity_Outbox");
    expect(outbox).toHaveLength(2);
    expect(outbox.every((o) => o.delivered_at !== null)).toBe(true);
    const ids = (await (await logs()).find().toArray()).map((d) => d.event_id).sort();
    expect(ids).toEqual(outbox.map((o) => o.event_id).sort());
  });

  it("redelivery is idempotent: flushing the same events again never duplicates them", async () => {
    const donorId = await makeDonor();
    await setAvailability(await makeStaff(await makeHospital()), donorId, "Unavailable");
    await (await db()).query("UPDATE Activity_Outbox SET delivered_at = NULL"); // pretend the acknowledgement was lost
    const result = await flushOutbox();
    expect(result).toMatchObject({ delivered: 1, pending: 0, error: null });
    expect(await (await logs()).countDocuments()).toBe(1);
  });

  it("when MongoDB is down the business change still commits, the event waits, and reconcile delivers it later", async () => {
    const { staff, requestId } = await scenario({ units: 1 });
    const donorId = await makeDonor();

    process.env.MONGODB_URI = "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=500"; // nothing listens here
    const result = await recordDonation(staff, { donor_id: donorId, request_id: requestId, units_donated: 1, donation_date: null });

    expect(result.activity_log).toBe("queued");
    expect(result.request).toMatchObject({ status: "Fulfilled" }); // MySQL side fully committed
    expect(await pendingCount()).toBe(2);
    const failed = await q1<{ attempts: number; last_error: string | null }>("SELECT attempts, last_error FROM Activity_Outbox ORDER BY outbox_id LIMIT 1");
    expect(failed.attempts).toBeGreaterThanOrEqual(1);
    expect(failed.last_error).toBeTruthy();
    expect(await (await logs()).countDocuments()).toBe(0);

    process.env.MONGODB_URI = REAL_URI; // MongoDB "comes back"
    const flushed = await flushOutbox();
    expect(flushed).toMatchObject({ delivered: 2, pending: 0, error: null });
    const actions = (await (await logs()).find().sort({ timestamp: 1 }).toArray()).map((d) => d.action);
    expect(actions).toEqual(["donation_recorded", "request_status_changed"]);
  });
});

describe("aggregation pipeline (activity statistics)", () => {
  const doc = (i: number, action: string, entity: string, iso: string) => ({
    event_id: `agg-${i}`,
    entity_type: entity,
    entity_id: i,
    action,
    timestamp: new Date(iso),
    details: {},
    performed_by: { user_id: null, role: "SYSTEM", email: null },
    related: {},
  });

  beforeEach(async () => {
    // Times are chosen in IST (UTC+05:30), the configured APP_TIMEZONE default.
    await (await logs()).insertMany([
      doc(1, "request_created", "request", "2026-03-02T04:00:00Z"), // Mon 2 Mar, IST
      doc(2, "request_created", "request", "2026-03-02T09:00:00Z"),
      doc(3, "donation_recorded", "donation", "2026-03-02T10:00:00Z"),
      doc(4, "donation_recorded", "donation", "2026-03-04T10:00:00Z"), // Wed 4 Mar
      doc(5, "donor_availability_changed", "donor", "2026-03-08T19:00:00Z"), // 00:30 Mon 9 Mar IST -> next ISO week
      doc(6, "request_created", "request", "2026-01-01T06:00:00Z"), // outside the range below
    ]);
  });

  const range = { from: new Date("2026-03-01T00:00:00Z"), to: new Date("2026-03-31T00:00:00Z") };

  it("groups by day in the configured time zone", async () => {
    const stats = await activityStats({ granularity: "day", ...range });
    expect(stats.total).toBe(5);
    expect(stats.by_period).toEqual([
      { period: "2026-03-02", total: 3, actions: [{ action: "donation_recorded", count: 1 }, { action: "request_created", count: 2 }] },
      { period: "2026-03-04", total: 1, actions: [{ action: "donation_recorded", count: 1 }] },
      { period: "2026-03-09", total: 1, actions: [{ action: "donor_availability_changed", count: 1 }] },
    ]);
  });

  it("groups by ISO week", async () => {
    const stats = await activityStats({ granularity: "week", ...range });
    expect(stats.by_period.map((p) => [p.period, p.total])).toEqual([
      ["2026-W10", 4],
      ["2026-W11", 1],
    ]);
  });

  it("also returns totals by action and by entity type", async () => {
    const stats = await activityStats({ granularity: "day", ...range });
    expect(stats.by_action).toEqual([
      { action: "donation_recorded", count: 2 },
      { action: "request_created", count: 2 },
      { action: "donor_availability_changed", count: 1 },
    ]);
    expect(stats.by_entity_type).toEqual([
      { entity_type: "donation", count: 2 },
      { entity_type: "request", count: 2 },
      { entity_type: "donor", count: 1 },
    ]);
  });

  it("returns empty results, not an error, when there is no activity", async () => {
    const stats = await activityStats({ from: new Date("2030-01-01"), to: new Date("2030-02-01") });
    expect(stats).toMatchObject({ total: 0, by_period: [], by_action: [], by_entity_type: [] });
  });
});
