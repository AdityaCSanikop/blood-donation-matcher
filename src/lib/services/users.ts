import { recordActivity, flushAfterCommit } from "../activity";
import { hashPassword, verifyPassword, type SessionUser } from "../auth";
import { AppError } from "../errors";
import { getPool, one, run, withTransaction } from "../mysql";
import type { DonorInput } from "./donors";

type UserRow = SessionUser & { password_hash: string };

const COLUMNS = "user_id, email, display_name, role, hospital_id, donor_id";

export async function getUser(id: number): Promise<SessionUser | null> {
  return one<SessionUser>(getPool(), `SELECT ${COLUMNS} FROM App_User WHERE user_id = ?`, [id]);
}

// Throw-away hash so a login attempt for an unknown email takes as long as
// one for a real account (does not reveal which emails are registered).
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(`no-such-user-${Math.random()}`));

export async function login(email: string, password: string): Promise<SessionUser> {
  const user = await one<UserRow>(getPool(), `SELECT ${COLUMNS}, password_hash FROM App_User WHERE email = ?`, [email]);
  const valid = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));
  if (!user || !valid) throw new AppError(401, "BAD_CREDENTIALS", "Email or password is incorrect.");
  const { password_hash: _omit, ...session } = user;
  void _omit;
  return session;
}

/** Donor self-registration: Donor row + login created atomically. */
export async function registerDonor(input: Omit<DonorInput, "availability_status"> & { email: string; password: string }) {
  const hash = await hashPassword(input.password);
  const userId = await withTransaction(async (conn) => {
    const donor = await run(
      conn,
      `INSERT INTO Donor (name, blood_group, phone, gender, dob, city, last_donation_date) VALUES (?,?,?,?,?,?,?)`,
      [input.name, input.blood_group, input.phone, input.gender, input.dob, input.city, input.last_donation_date],
    );
    const user = await run(
      conn,
      "INSERT INTO App_User (email, password_hash, display_name, role, donor_id) VALUES (?,?,?,'DONOR',?)",
      [input.email, hash, input.name, donor.insertId],
    );
    await recordActivity(
      conn,
      { user_id: user.insertId, email: input.email, display_name: input.name, role: "DONOR", hospital_id: null, donor_id: donor.insertId },
      {
        entity_type: "donor",
        entity_id: donor.insertId,
        action: "donor_registered",
        details: { blood_group: input.blood_group, city: input.city, registered_by: "self" },
        related: { donor_id: donor.insertId },
      },
    );
    return user.insertId;
  });
  await flushAfterCommit();
  return (await getUser(userId))!;
}

/** Staff can add another staff login for their own hospital. */
export async function createStaffUser(actor: SessionUser, input: { email: string; password: string; display_name: string }) {
  if (actor.role !== "STAFF" || !actor.hospital_id) throw new AppError(403, "FORBIDDEN", "Only hospital staff can add staff accounts.");
  const hash = await hashPassword(input.password);
  const result = await run(
    getPool(),
    "INSERT INTO App_User (email, password_hash, display_name, role, hospital_id) VALUES (?,?,?,'STAFF',?)",
    [input.email, hash, input.display_name, actor.hospital_id],
  );
  return (await getUser(result.insertId))!;
}
