import { recordActivity, flushAfterCommit } from "../activity";
import { assertOwnHospital, type SessionUser } from "../auth";
import { AppError, notFound } from "../errors";
import { getPool, one, rows, run, withTransaction, type SqlValue } from "../mysql";
import type { BloodGroup } from "../constants";

export type RecipientInput = { name: string; blood_group: BloodGroup; phone: string | null; age: number | null };

const SELECT = `
  SELECT r.recipient_id, r.name, r.blood_group, r.phone, r.age, r.hospital_id,
         h.name AS hospital_name, h.city AS hospital_city,
         (SELECT COUNT(*) FROM Blood_Request br WHERE br.recipient_id = r.recipient_id) AS request_count,
         (SELECT COUNT(*) FROM Blood_Request br
           WHERE br.recipient_id = r.recipient_id
             AND br.status IN ('Pending','Partially_Fulfilled')) AS open_request_count
    FROM Recipient r
    JOIN Hospital h ON h.hospital_id = r.hospital_id`;

export async function listRecipients(filter: { hospital_id?: number; q?: string; blood_group?: string } = {}) {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (filter.hospital_id) {
    where.push("r.hospital_id = ?");
    params.push(filter.hospital_id);
  }
  if (filter.blood_group) {
    where.push("r.blood_group = ?");
    params.push(filter.blood_group);
  }
  if (filter.q) {
    where.push("r.name LIKE ?");
    params.push(`%${filter.q}%`);
  }
  return rows(getPool(), `${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY r.name, r.recipient_id`, params);
}

export async function getRecipient(id: number) {
  const recipient = await one<{ recipient_id: number; hospital_id: number; blood_group: BloodGroup }>(
    getPool(),
    `${SELECT} WHERE r.recipient_id = ?`,
    [id],
  );
  if (!recipient) throw notFound("Recipient");
  return recipient;
}

/** Recipients are always registered at the signed-in staff member's hospital. */
export async function createRecipient(actor: SessionUser, input: RecipientInput) {
  if (actor.role !== "STAFF" || !actor.hospital_id) throw new AppError(403, "FORBIDDEN", "Only hospital staff can register recipients.");
  const hospitalId = actor.hospital_id;
  const id = await withTransaction(async (conn) => {
    const result = await run(conn, "INSERT INTO Recipient (name, blood_group, phone, age, hospital_id) VALUES (?,?,?,?,?)", [
      input.name,
      input.blood_group,
      input.phone,
      input.age,
      hospitalId,
    ]);
    await recordActivity(conn, actor, {
      entity_type: "recipient",
      entity_id: result.insertId,
      action: "recipient_registered",
      details: { blood_group: input.blood_group },
      related: { recipient_id: result.insertId, hospital_id: hospitalId },
    });
    return result.insertId;
  });
  const activity_log = await flushAfterCommit();
  return { recipient: await getRecipient(id), activity_log };
}

export async function updateRecipient(actor: SessionUser, id: number, input: Partial<RecipientInput>) {
  const current = await getRecipient(id);
  assertOwnHospital(actor, current.hospital_id);
  if (input.blood_group && input.blood_group !== current.blood_group) {
    const open = await one<{ n: number }>(
      getPool(),
      "SELECT COUNT(*) AS n FROM Blood_Request WHERE recipient_id = ? AND status IN ('Pending','Partially_Fulfilled')",
      [id],
    );
    if (Number(open?.n) > 0) {
      throw new AppError(409, "HAS_OPEN_REQUESTS", "Cancel this recipient's open requests before changing their blood group.");
    }
  }
  const fields = Object.entries(input).filter(([, v]) => v !== undefined);
  if (fields.length > 0) {
    await run(getPool(), `UPDATE Recipient SET ${fields.map(([k]) => `${k} = ?`).join(", ")} WHERE recipient_id = ?`, [
      ...fields.map(([, v]) => v as SqlValue),
      id,
    ]);
  }
  return getRecipient(id);
}

export async function deleteRecipient(actor: SessionUser, id: number) {
  const current = await getRecipient(id);
  assertOwnHospital(actor, current.hospital_id);
  await run(getPool(), "DELETE FROM Recipient WHERE recipient_id = ?", [id]);
}
