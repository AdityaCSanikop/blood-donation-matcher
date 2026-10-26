import { recordActivity, flushAfterCommit } from "../activity";
import { assertOwnHospital, hashPassword, type SessionUser } from "../auth";
import { notFound } from "../errors";
import { getPool, one, rows, run, withTransaction, type SqlValue } from "../mysql";

export type HospitalInput = { name: string; address: string | null; city: string; phone: string };

const SELECT = `
  SELECT h.hospital_id, h.name, h.address, h.city, h.phone,
         s.donation_count, s.units_collected, s.distinct_donors, s.last_donation_date,
         s.total_requests, s.open_requests, s.units_outstanding
    FROM Hospital h
    JOIN vw_hospital_donation_stats s ON s.hospital_id = h.hospital_id`;

export async function listHospitals(filter: { q?: string; city?: string } = {}) {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (filter.q) {
    where.push("(h.name LIKE ? OR h.city LIKE ?)");
    params.push(`%${filter.q}%`, `%${filter.q}%`);
  }
  if (filter.city) {
    where.push("h.city = ?");
    params.push(filter.city);
  }
  return rows(getPool(), `${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY h.name`, params);
}

export async function getHospital(id: number) {
  const hospital = await one(getPool(), `${SELECT} WHERE h.hospital_id = ?`, [id]);
  if (!hospital) throw notFound("Hospital");
  return hospital;
}

export type FirstStaff = { email: string; password: string; display_name: string };

/**
 * Register a hospital. Optionally creates its first staff login in the same
 * transaction, so a hospital is never left without anyone able to manage it.
 */
export async function createHospital(actor: SessionUser, input: HospitalInput, firstStaff?: FirstStaff) {
  const staffHash = firstStaff ? await hashPassword(firstStaff.password) : null;
  const id = await withTransaction(async (conn) => {
    const result = await run(conn, "INSERT INTO Hospital (name, address, city, phone) VALUES (?,?,?,?)", [
      input.name,
      input.address,
      input.city,
      input.phone,
    ]);
    if (firstStaff && staffHash) {
      await run(conn, "INSERT INTO App_User (email, password_hash, display_name, role, hospital_id) VALUES (?,?,?,'STAFF',?)", [
        firstStaff.email,
        staffHash,
        firstStaff.display_name,
        result.insertId,
      ]);
    }
    await recordActivity(conn, actor, {
      entity_type: "hospital",
      entity_id: result.insertId,
      action: "hospital_registered",
      details: { name: input.name, city: input.city, staff_login_created: Boolean(firstStaff) },
      related: { hospital_id: result.insertId },
    });
    return result.insertId;
  });
  const activity_log = await flushAfterCommit();
  return { hospital: await getHospital(id), activity_log };
}

export async function updateHospital(actor: SessionUser, id: number, input: Partial<HospitalInput>) {
  await getHospital(id);
  assertOwnHospital(actor, id);
  const fields = Object.entries(input).filter(([, v]) => v !== undefined);
  if (fields.length > 0) {
    await run(
      getPool(),
      `UPDATE Hospital SET ${fields.map(([k]) => `${k} = ?`).join(", ")} WHERE hospital_id = ?`,
      [...fields.map(([, v]) => v as SqlValue), id],
    );
  }
  return getHospital(id);
}

/** The foreign keys (ON DELETE RESTRICT) refuse this while anything references the hospital. */
export async function deleteHospital(id: number) {
  const result = await run(getPool(), "DELETE FROM Hospital WHERE hospital_id = ?", [id]);
  if (result.affectedRows === 0) throw notFound("Hospital");
}
