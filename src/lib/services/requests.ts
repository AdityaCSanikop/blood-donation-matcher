import { recordActivity, flushAfterCommit } from "../activity";
import { assertOwnHospital, type SessionUser } from "../auth";
import { AppError, notFound } from "../errors";
import { callRows, getPool, one, rows, run, withTransaction, type SqlValue } from "../mysql";
import { OPEN_STATUSES, type BloodGroup, type RequestStatus, type UrgencyLevel } from "../constants";

export type RequestInput = {
  recipient_id: number;
  blood_group_needed?: BloodGroup;
  units_required: number;
  urgency_level: UrgencyLevel;
  notes: string | null;
};

export type RequestRow = {
  request_id: number;
  recipient_id: number;
  hospital_id: number;
  blood_group_needed: BloodGroup;
  units_required: number;
  units_fulfilled: number;
  units_remaining: number;
  urgency_level: UrgencyLevel;
  request_date: string;
  status: RequestStatus;
  notes: string | null;
};

const SELECT = `
  SELECT br.request_id, br.recipient_id, r.name AS recipient_name, r.blood_group AS recipient_blood_group,
         br.hospital_id, h.name AS hospital_name, h.city AS hospital_city,
         br.blood_group_needed, br.units_required, br.units_fulfilled,
         br.units_required - br.units_fulfilled AS units_remaining,
         br.urgency_level, br.request_date, DATEDIFF(CURDATE(), br.request_date) AS days_waiting,
         br.status, br.notes
    FROM Blood_Request br
    JOIN Recipient r ON r.recipient_id = br.recipient_id
    JOIN Hospital  h ON h.hospital_id  = br.hospital_id`;

export type RequestFilter = { status?: string; hospital_id?: number; urgency?: string; blood_group?: string; recipient_id?: number };

/**
 * status = "open" (default) reads the priority-queue view, which also counts
 * the donors who could serve each request right now.
 * Ordering is always: open before closed, then urgency (ENUM order =
 * Critical, High, Medium, Low), then the oldest request first.
 */
export async function listRequests(filter: RequestFilter = {}) {
  const status = filter.status ?? "open";
  const where: string[] = [];
  const params: SqlValue[] = [];
  const t = status === "open" ? "q" : "br";

  if (filter.hospital_id) {
    where.push(`${t}.hospital_id = ?`);
    params.push(filter.hospital_id);
  }
  if (filter.recipient_id) {
    where.push(`${t}.recipient_id = ?`);
    params.push(filter.recipient_id);
  }
  if (filter.urgency) {
    where.push(`${t}.urgency_level = ?`);
    params.push(filter.urgency);
  }
  if (filter.blood_group) {
    where.push(`${t}.blood_group_needed = ?`);
    params.push(filter.blood_group);
  }

  if (status === "open") {
    return rows<RequestRow & { eligible_donor_count: number }>(
      getPool(),
      `SELECT q.* FROM vw_request_queue q
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY q.urgency_level, q.request_date, q.request_id`,
      params,
    );
  }
  if (status !== "all") {
    where.push("br.status = ?");
    params.push(status);
  }
  return rows<RequestRow>(
    getPool(),
    `${SELECT}
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY (br.status IN ('Pending','Partially_Fulfilled')) DESC,
               br.urgency_level, br.request_date, br.request_id`,
    params,
  );
}

export async function getRequest(id: number) {
  const request = await one<RequestRow>(getPool(), `${SELECT} WHERE br.request_id = ?`, [id]);
  if (!request) throw notFound("Blood request");
  const donations = await rows(
    getPool(),
    "SELECT * FROM vw_donation_history WHERE request_id = ? ORDER BY donation_date DESC, donation_id DESC",
    [id],
  );
  return { ...request, donations };
}

export async function createRequest(actor: SessionUser, input: RequestInput) {
  const id = await withTransaction(async (conn) => {
    const recipient = await one<{ hospital_id: number; blood_group: BloodGroup }>(
      conn,
      "SELECT hospital_id, blood_group FROM Recipient WHERE recipient_id = ?",
      [input.recipient_id],
    );
    if (!recipient) throw notFound("Recipient");
    assertOwnHospital(actor, recipient.hospital_id);

    const needed = input.blood_group_needed ?? recipient.blood_group;
    // trg_request_before_insert verifies hospital + group compatibility and
    // forces units_fulfilled = 0 / status = 'Pending'.
    const result = await run(
      conn,
      `INSERT INTO Blood_Request (recipient_id, hospital_id, blood_group_needed, units_required, urgency_level, request_date, notes)
       VALUES (?,?,?,?,?,CURDATE(),?)`,
      [input.recipient_id, recipient.hospital_id, needed, input.units_required, input.urgency_level, input.notes],
    );
    await recordActivity(conn, actor, {
      entity_type: "request",
      entity_id: result.insertId,
      action: "request_created",
      details: { blood_group: needed, units_required: input.units_required, urgency: input.urgency_level },
      related: { request_id: result.insertId, hospital_id: recipient.hospital_id, recipient_id: input.recipient_id },
    });
    return result.insertId;
  });
  const activity_log = await flushAfterCommit();
  return { request: await getRequest(id), activity_log };
}

type Locked = Pick<RequestRow, "hospital_id" | "status" | "units_required" | "units_fulfilled" | "urgency_level" | "notes">;

async function lockRequest(conn: Parameters<typeof one>[0], id: number): Promise<Locked> {
  const row = await one<Locked>(
    conn,
    "SELECT hospital_id, status, units_required, units_fulfilled, urgency_level, notes FROM Blood_Request WHERE request_id = ? FOR UPDATE",
    [id],
  );
  if (!row) throw notFound("Blood request");
  return row;
}

export async function updateRequest(
  actor: SessionUser,
  id: number,
  input: { units_required?: number; urgency_level?: UrgencyLevel; notes?: string | null },
) {
  await withTransaction(async (conn) => {
    const before = await lockRequest(conn, id);
    assertOwnHospital(actor, before.hospital_id);
    if (!OPEN_STATUSES.includes(before.status)) {
      throw new AppError(409, before.status === "Cancelled" ? "REQUEST_CANCELLED" : "REQUEST_ALREADY_FULFILLED",
        `A ${before.status.toLowerCase().replace("_", " ")} request can no longer be edited.`);
    }
    const fields = Object.entries(input).filter(([, v]) => v !== undefined);
    if (fields.length === 0) return;
    // status is recalculated by trg_request_before_update (e.g. lowering
    // units_required to what was already donated makes it Fulfilled).
    await run(conn, `UPDATE Blood_Request SET ${fields.map(([k]) => `${k} = ?`).join(", ")} WHERE request_id = ?`, [
      ...fields.map(([, v]) => v as SqlValue),
      id,
    ]);
    const after = await lockRequest(conn, id);
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of ["units_required", "urgency_level", "notes"] as const) {
      if (before[k] !== after[k]) changes[k] = { from: before[k], to: after[k] };
    }
    if (Object.keys(changes).length > 0) {
      await recordActivity(conn, actor, {
        entity_type: "request",
        entity_id: id,
        action: "request_updated",
        details: { changes },
        related: { request_id: id, hospital_id: before.hospital_id },
      });
    }
    if (before.status !== after.status) {
      await recordActivity(conn, actor, {
        entity_type: "request",
        entity_id: id,
        action: "request_status_changed",
        details: { old_status: before.status, new_status: after.status, reason: "units_required changed" },
        related: { request_id: id, hospital_id: before.hospital_id },
      });
    }
  });
  const activity_log = await flushAfterCommit();
  return { request: await getRequest(id), activity_log };
}

export async function cancelRequest(actor: SessionUser, id: number, reason: string | null = null) {
  await withTransaction(async (conn) => {
    const before = await lockRequest(conn, id);
    assertOwnHospital(actor, before.hospital_id);
    if (before.status === "Cancelled") throw new AppError(409, "REQUEST_CANCELLED", "This request is already cancelled.");
    // trg_request_before_update refuses to cancel a Fulfilled request.
    await run(conn, "UPDATE Blood_Request SET status = 'Cancelled' WHERE request_id = ?", [id]);
    await recordActivity(conn, actor, {
      entity_type: "request",
      entity_id: id,
      action: "request_status_changed",
      details: { old_status: before.status, new_status: "Cancelled", reason: reason ?? "cancelled by staff", units_fulfilled: before.units_fulfilled },
      related: { request_id: id, hospital_id: before.hospital_id },
    });
  });
  const activity_log = await flushAfterCommit();
  return { request: await getRequest(id), activity_log };
}

export type MatchRow = {
  donor_id: number;
  name: string;
  blood_group: BloodGroup;
  phone: string;
  city: string;
  last_donation_date: string | null;
  days_since_last_donation: number | null;
  is_eligible: number;
  next_eligible_date: string | null;
  exact_group_match: number;
  same_city: number;
};

/**
 * Compatible donors for a request, ranked by sp_match_donors.
 * `includeIneligible` also lists donors still inside the 90-day interval
 * (flagged, with the date they become eligible) so staff can plan ahead.
 */
export async function matchDonors(id: number, includeIneligible = false) {
  const request = await getRequest(id);
  if (!OPEN_STATUSES.includes(request.status)) {
    return {
      request,
      matches: [] as MatchRow[],
      summary: { eligible: 0, listed: 0, units_remaining: 0 },
      message: `This request is ${request.status.toLowerCase().replace("_", " ")}; matching only applies to open requests.`,
    };
  }
  const matches = await callRows<MatchRow>(getPool(), "CALL sp_match_donors(?, ?)", [id, includeIneligible ? 0 : 1]);
  const eligible = matches.filter((m) => Number(m.is_eligible) === 1).length;
  let message: string | null = null;
  if (matches.length === 0) {
    message = includeIneligible
      ? "No available donor with a compatible blood group is registered."
      : "No compatible donor is available and eligible right now. Include donors in their waiting period to see who becomes eligible soon.";
  } else if (eligible === 0) {
    message = "Compatible donors exist, but all of them are still within 90 days of their last donation.";
  } else if (eligible < request.units_remaining) {
    message = `Only ${eligible} eligible donor(s) for ${request.units_remaining} unit(s) still needed.`;
  }
  return { request, matches, summary: { eligible, listed: matches.length, units_remaining: request.units_remaining }, message };
}
