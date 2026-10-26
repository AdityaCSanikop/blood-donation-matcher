import { recordActivity, flushAfterCommit } from "../activity";
import { assertOwnHospital, type SessionUser } from "../auth";
import { AppError, notFound } from "../errors";
import { getPool, one, rows, run, withTransaction, type SqlValue } from "../mysql";
import type { RequestStatus } from "../constants";

export type DonationInput = {
  donor_id: number;
  request_id: number | null;
  donation_date: string | null; // null = today (database date)
  units_donated: number;
};

export async function listDonations(filter: { donor_id?: number; hospital_id?: number; request_id?: number; limit?: number } = {}) {
  const where: string[] = [];
  const params: SqlValue[] = [];
  for (const key of ["donor_id", "hospital_id", "request_id"] as const) {
    if (filter[key]) {
      where.push(`${key} = ?`);
      params.push(filter[key]!);
    }
  }
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500);
  return rows(
    getPool(),
    `SELECT * FROM vw_donation_history
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY donation_date DESC, donation_id DESC
      LIMIT ?`,
    [...params, limit],
  );
}

type RequestState = { hospital_id: number; status: RequestStatus; units_required: number; units_fulfilled: number };

/**
 * Record a donation — the project's main TRANSACTION.
 *
 * Inside one MySQL transaction:
 *   1. lock the request row (SELECT ... FOR UPDATE) and remember its state
 *   2. CALL sp_record_donation -> policy checks + INSERT; the triggers then
 *      update units_fulfilled / status / last_donation_date
 *   3. write the activity events to the outbox
 * Any failure (rule violation, constraint, crash) rolls ALL of it back, so a
 * donation can never exist without its fulfilment update, or vice versa.
 */
export async function recordDonation(actor: SessionUser, input: DonationInput) {
  if (actor.role !== "STAFF" || !actor.hospital_id) throw new AppError(403, "FORBIDDEN", "Only hospital staff can record donations.");
  const hospitalId = actor.hospital_id;

  const donationId = await withTransaction(async (conn) => {
    let before: RequestState | null = null;
    if (input.request_id !== null) {
      before = await one<RequestState>(
        conn,
        "SELECT hospital_id, status, units_required, units_fulfilled FROM Blood_Request WHERE request_id = ? FOR UPDATE",
        [input.request_id],
      );
      if (!before) throw notFound("Blood request");
      assertOwnHospital(actor, before.hospital_id);
    }

    await conn.query("CALL sp_record_donation(?, ?, ?, COALESCE(?, CURDATE()), ?, @bdm_donation_id)", [
      input.donor_id,
      hospitalId,
      input.request_id,
      input.donation_date,
      input.units_donated,
    ]);
    const created = await one<{ id: number; donation_date: string }>(
      conn,
      "SELECT donation_id AS id, donation_date FROM Donation WHERE donation_id = @bdm_donation_id",
    );
    if (!created) throw new AppError(500, "INTERNAL", "The donation could not be recorded.");

    await recordActivity(conn, actor, {
      entity_type: "donation",
      entity_id: created.id,
      action: "donation_recorded",
      details: { units_donated: input.units_donated, donation_date: created.donation_date, walk_in: input.request_id === null },
      related: { donor_id: input.donor_id, hospital_id: hospitalId, ...(input.request_id ? { request_id: input.request_id } : {}) },
    });

    if (before && input.request_id !== null) {
      const after = await one<RequestState>(
        conn,
        "SELECT hospital_id, status, units_required, units_fulfilled FROM Blood_Request WHERE request_id = ?",
        [input.request_id],
      );
      if (after && after.status !== before.status) {
        await recordActivity(conn, actor, {
          entity_type: "request",
          entity_id: input.request_id,
          action: "request_status_changed",
          details: {
            old_status: before.status,
            new_status: after.status,
            units_fulfilled: after.units_fulfilled,
            units_required: after.units_required,
            reason: "donation recorded",
            donation_id: created.id,
          },
          related: { request_id: input.request_id, hospital_id: hospitalId, donor_id: input.donor_id },
        });
      }
    }
    return created.id;
  });

  const activity_log = await flushAfterCommit();
  const donation = await one(getPool(), "SELECT * FROM vw_donation_history WHERE donation_id = ?", [donationId]);
  const request = input.request_id
    ? await one(
        getPool(),
        "SELECT request_id, status, units_required, units_fulfilled, units_required - units_fulfilled AS units_remaining FROM Blood_Request WHERE request_id = ?",
        [input.request_id],
      )
    : null;
  return { donation, request, activity_log };
}

/** Delete a wrongly entered donation; trg_donation_after_delete reverses its effects. */
export async function deleteDonation(actor: SessionUser, id: number) {
  await withTransaction(async (conn) => {
    const donation = await one<{ donor_id: number; hospital_id: number; request_id: number | null; units_donated: number }>(
      conn,
      "SELECT donor_id, hospital_id, request_id, units_donated FROM Donation WHERE donation_id = ? FOR UPDATE",
      [id],
    );
    if (!donation) throw notFound("Donation");
    assertOwnHospital(actor, donation.hospital_id);

    const before = donation.request_id
      ? await one<{ status: RequestStatus }>(conn, "SELECT status FROM Blood_Request WHERE request_id = ? FOR UPDATE", [donation.request_id])
      : null;

    await run(conn, "DELETE FROM Donation WHERE donation_id = ?", [id]);

    await recordActivity(conn, actor, {
      entity_type: "donation",
      entity_id: id,
      action: "donation_deleted",
      details: { units_donated: donation.units_donated },
      related: { donor_id: donation.donor_id, hospital_id: donation.hospital_id, ...(donation.request_id ? { request_id: donation.request_id } : {}) },
    });
    if (before && donation.request_id) {
      const after = await one<{ status: RequestStatus }>(conn, "SELECT status FROM Blood_Request WHERE request_id = ?", [donation.request_id]);
      if (after && after.status !== before.status) {
        await recordActivity(conn, actor, {
          entity_type: "request",
          entity_id: donation.request_id,
          action: "request_status_changed",
          details: { old_status: before.status, new_status: after.status, reason: "donation deleted", donation_id: id },
          related: { request_id: donation.request_id, hospital_id: donation.hospital_id },
        });
      }
    }
  });
  return { activity_log: await flushAfterCommit() };
}
