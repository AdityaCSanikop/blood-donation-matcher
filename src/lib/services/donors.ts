import { recordActivity, flushAfterCommit } from "../activity";
import type { SessionUser } from "../auth";
import { AppError, forbidden, notFound } from "../errors";
import { getPool, one, rows, run, withTransaction, type SqlValue } from "../mysql";
import type { Availability, BloodGroup } from "../constants";

export type DonorInput = {
  name: string;
  blood_group: BloodGroup;
  phone: string;
  gender: "M" | "F" | "Other" | null;
  dob: string | null;
  city: string;
  last_donation_date: string | null;
  availability_status: Availability;
};

export type DonorFilter = {
  q?: string;
  blood_group?: string;
  city?: string;
  availability?: string;
  /** "yes" = can donate now, "no" = cannot */
  ready?: "yes" | "no";
  limit?: number;
};

/** A donor may act on their own record; staff may act on any donor. */
export function assertDonorAccess(actor: SessionUser, donorId: number) {
  if (actor.role === "STAFF") return;
  if (actor.role === "DONOR" && actor.donor_id === donorId) return;
  throw forbidden("You can only access your own donor profile.");
}

export async function listDonors(filter: DonorFilter = {}) {
  const where: string[] = [];
  const params: SqlValue[] = [];
  let relevance = "";

  const q = filter.q?.trim();
  if (q) {
    const terms = q.split(/\s+/).map((t) => t.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
    // InnoDB full-text ignores tokens shorter than 3 characters, so short
    // searches fall back to a prefix LIKE instead of returning nothing.
    if (terms.length > 0 && terms.every((t) => t.length >= 3)) {
      const boolean = terms.map((t) => `+${t}*`).join(" ");
      where.push("MATCH(d.name, d.city) AGAINST (? IN BOOLEAN MODE)");
      params.push(boolean);
      relevance = "full-text";
    } else {
      where.push("(d.name LIKE ? OR d.city LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
      relevance = "like";
    }
  }
  if (filter.blood_group) {
    where.push("v.blood_group = ?");
    params.push(filter.blood_group);
  }
  if (filter.city) {
    where.push("v.city = ?");
    params.push(filter.city);
  }
  if (filter.availability) {
    where.push("v.availability_status = ?");
    params.push(filter.availability);
  }
  if (filter.ready === "yes") where.push("v.can_donate_now = 1");
  if (filter.ready === "no") where.push("v.can_donate_now = 0");

  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500);
  const items = await rows(
    getPool(),
    `SELECT v.*
       FROM vw_donor_eligibility v
       JOIN Donor d ON d.donor_id = v.donor_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY v.name, v.donor_id
      LIMIT ?`,
    [...params, limit],
  );
  return { items, search: relevance || null };
}

export async function getDonor(id: number) {
  const donor = await one(getPool(), "SELECT * FROM vw_donor_eligibility WHERE donor_id = ?", [id]);
  if (!donor) throw notFound("Donor");
  return donor;
}

export async function createDonor(actor: SessionUser, input: DonorInput) {
  const id = await withTransaction(async (conn) => {
    const result = await run(
      conn,
      `INSERT INTO Donor (name, blood_group, phone, gender, dob, city, last_donation_date, availability_status)
       VALUES (?,?,?,?,?,?,?,?)`,
      [input.name, input.blood_group, input.phone, input.gender, input.dob, input.city, input.last_donation_date, input.availability_status],
    );
    await recordActivity(conn, actor, {
      entity_type: "donor",
      entity_id: result.insertId,
      action: "donor_registered",
      details: { blood_group: input.blood_group, city: input.city, registered_by: "staff" },
      related: { donor_id: result.insertId },
    });
    return result.insertId;
  });
  const activity_log = await flushAfterCommit();
  return { donor: await getDonor(id), activity_log };
}

export async function updateDonor(actor: SessionUser, id: number, input: Partial<DonorInput>) {
  assertDonorAccess(actor, id);
  const fields = Object.entries(input).filter(([, v]) => v !== undefined);
  await withTransaction(async (conn) => {
    const before = await one<Record<string, unknown>>(conn, "SELECT * FROM Donor WHERE donor_id = ? FOR UPDATE", [id]);
    if (!before) throw notFound("Donor");
    const changed = fields.filter(([k, v]) => before[k] !== v).map(([k]) => k);
    if (changed.length === 0) return;
    await run(conn, `UPDATE Donor SET ${fields.map(([k]) => `${k} = ?`).join(", ")} WHERE donor_id = ?`, [
      ...fields.map(([, v]) => v as SqlValue),
      id,
    ]);
    await recordActivity(conn, actor, {
      entity_type: "donor",
      entity_id: id,
      action: "donor_profile_updated",
      details: { changed_fields: changed },
      related: { donor_id: id },
    });
  });
  const activity_log = await flushAfterCommit();
  return { donor: await getDonor(id), activity_log };
}

export async function setAvailability(actor: SessionUser, id: number, status: Availability) {
  assertDonorAccess(actor, id);
  const changed = await withTransaction(async (conn) => {
    // Lock the row so two simultaneous toggles log a consistent old -> new pair.
    const before = await one<{ availability_status: Availability }>(
      conn,
      "SELECT availability_status FROM Donor WHERE donor_id = ? FOR UPDATE",
      [id],
    );
    if (!before) throw notFound("Donor");
    if (before.availability_status === status) return false;
    await run(conn, "UPDATE Donor SET availability_status = ? WHERE donor_id = ?", [status, id]);
    await recordActivity(conn, actor, {
      entity_type: "donor",
      entity_id: id,
      action: "donor_availability_changed",
      details: { old_status: before.availability_status, new_status: status },
      related: { donor_id: id },
    });
    return true;
  });
  const activity_log = changed ? await flushAfterCommit() : "delivered";
  return { donor: await getDonor(id), changed, activity_log };
}

export async function deleteDonor(id: number) {
  const result = await run(getPool(), "DELETE FROM Donor WHERE donor_id = ?", [id]);
  if (result.affectedRows === 0) throw notFound("Donor");
}

/** Reverse matching: open requests this donor's blood group could serve, most urgent first. */
export async function openRequestsForDonor(donorId: number) {
  await getDonor(donorId);
  return rows(
    getPool(),
    `SELECT q.request_id, q.hospital_name, q.hospital_city, q.blood_group_needed, q.units_remaining,
            q.urgency_level, q.request_date, q.days_waiting, q.status,
            (dr.donor_id IS NOT NULL) AS offered_help
       FROM vw_request_queue q
       JOIN Donor d ON d.donor_id = ?
       JOIN Compatibility c ON c.donor_blood_group = d.blood_group
                           AND c.recipient_blood_group = q.blood_group_needed
                           AND c.is_compatible = TRUE
       LEFT JOIN Donor_Response dr ON dr.donor_id = d.donor_id AND dr.request_id = q.request_id
      ORDER BY q.urgency_level, q.request_date, q.request_id`,
    [donorId],
  );
}

/** A donor offers to help with an open request their blood group can serve. Repeating the offer changes nothing. */
export async function offerHelp(actor: SessionUser, donorId: number, requestId: number) {
  const donor = await getDonor(donorId);
  if (!Number(donor.can_donate_now)) {
    throw new AppError(409, "DONOR_CANNOT_DONATE", "You can offer to help only while you are available and past the 90-day interval.");
  }
  const changed = await withTransaction(async (conn) => {
    const request = await one<{ hospital_id: number }>(
      conn,
      `SELECT q.hospital_id
         FROM vw_request_queue q
         JOIN Compatibility c ON c.donor_blood_group = ?
                             AND c.recipient_blood_group = q.blood_group_needed
                             AND c.is_compatible = TRUE
        WHERE q.request_id = ?`,
      [donor.blood_group as BloodGroup, requestId],
    );
    if (!request) throw notFound("Open request for your blood group");
    const result = await run(conn, "INSERT IGNORE INTO Donor_Response (donor_id, request_id) VALUES (?,?)", [donorId, requestId]);
    if (result.affectedRows === 0) return false;
    await recordActivity(conn, actor, {
      entity_type: "request",
      entity_id: requestId,
      action: "donor_offered_help",
      details: { donor_name: donor.name },
      related: { request_id: requestId, donor_id: donorId, hospital_id: request.hospital_id },
    });
    return true;
  });
  const activity_log = changed ? await flushAfterCommit() : "delivered";
  return { changed, activity_log };
}

/** A donor takes back an offer. Withdrawing one that does not exist changes nothing. */
export async function withdrawHelp(actor: SessionUser, donorId: number, requestId: number) {
  const changed = await withTransaction(async (conn) => {
    const result = await run(conn, "DELETE FROM Donor_Response WHERE donor_id = ? AND request_id = ?", [donorId, requestId]);
    if (result.affectedRows === 0) return false;
    await recordActivity(conn, actor, {
      entity_type: "request",
      entity_id: requestId,
      action: "donor_withdrew_help",
      details: {},
      related: { request_id: requestId, donor_id: donorId },
    });
    return true;
  });
  const activity_log = changed ? await flushAfterCommit() : "delivered";
  return { changed, activity_log };
}
