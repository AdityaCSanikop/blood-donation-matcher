/**
 * Shared test helpers. Everything here talks to the REAL test databases
 * (MySQL `blood_matcher_test`, MongoDB `blood_matcher_logs_test`).
 */
import mysql, { type Connection } from "mysql2/promise";
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";
import type { SessionUser } from "@/lib/auth";

if (!/test/i.test(process.env.MYSQL_DATABASE ?? "") || !/test/i.test(process.env.MONGODB_DB ?? "")) {
  throw new Error("Refusing to run tests: MYSQL_DATABASE and MONGODB_DB must both be *test* databases (.env.test).");
}

let admin: Connection | undefined;
let mongo: MongoClient | undefined;

/** Admin connection used only to prepare and inspect data. */
export async function db(): Promise<Connection> {
  admin ??= await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_ADMIN_USER || process.env.MYSQL_USER,
    password: process.env.MYSQL_ADMIN_PASSWORD || process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    dateStrings: true,
    decimalNumbers: true,
    multipleStatements: false,
  });
  // Same time zone as the application, so "today" means the same thing in fixtures and in the app.
  await admin.query("SET time_zone = ?", [process.env.APP_TIMEZONE || "+05:30"]);
  return admin;
}

export async function logs() {
  mongo ??= new MongoClient(process.env.MONGODB_URI_REAL ?? process.env.MONGODB_URI!);
  return mongo.db(process.env.MONGODB_DB).collection("activity_logs");
}

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await (await db()).query(sql, params);
  return rows as T[];
}
export async function q1<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await q<T>(sql, params))[0];
}

/** Empty every data table (Compatibility is reference data and is kept). */
export async function resetData() {
  const conn = await db();
  await conn.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const t of ["Activity_Outbox", "App_User", "Donation", "Blood_Request", "Recipient", "Donor", "Hospital"]) {
    await conn.query(`TRUNCATE TABLE ${t}`);
  }
  await conn.query("SET FOREIGN_KEY_CHECKS = 1");
  await (await logs()).deleteMany({});
}

export async function closeAll() {
  await admin?.end();
  admin = undefined;
  await mongo?.close();
  mongo = undefined;
}

export const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** The database's own idea of a date n days ago (avoids client/server clock zone differences). */
export async function dbDaysAgo(n: number): Promise<string> {
  return (await q1<{ d: string }>("SELECT DATE_SUB(CURDATE(), INTERVAL ? DAY) AS d", [n])).d;
}

let seq = 0;
const next = () => ++seq;

export async function makeHospital(over: Partial<{ name: string; city: string; phone: string }> = {}) {
  const n = next();
  const [r] = await (await db()).query("INSERT INTO Hospital (name, address, city, phone) VALUES (?,?,?,?)", [
    over.name ?? `Test Hospital ${n}`,
    "1 Test Street",
    over.city ?? "Bengaluru",
    over.phone ?? `0800${String(100000 + n)}`,
  ]);
  return (r as { insertId: number }).insertId;
}

export async function makeDonor(
  over: Partial<{ name: string; blood_group: string; city: string; last_donation_date: string | null; availability_status: string; phone: string }> = {},
) {
  const n = next();
  const [r] = await (await db()).query(
    "INSERT INTO Donor (name, blood_group, phone, city, last_donation_date, availability_status) VALUES (?,?,?,?,?,?)",
    [
      over.name ?? `Donor ${n}`,
      over.blood_group ?? "O+",
      over.phone ?? `9${String(100000000 + n)}`,
      over.city ?? "Bengaluru",
      over.last_donation_date ?? null,
      over.availability_status ?? "Available",
    ],
  );
  return (r as { insertId: number }).insertId;
}

export async function makeRecipient(hospitalId: number, over: Partial<{ name: string; blood_group: string }> = {}) {
  const n = next();
  const [r] = await (await db()).query("INSERT INTO Recipient (name, blood_group, phone, age, hospital_id) VALUES (?,?,?,?,?)", [
    over.name ?? `Recipient ${n}`,
    over.blood_group ?? "O+",
    null,
    40,
    hospitalId,
  ]);
  return (r as { insertId: number }).insertId;
}

export async function makeRequest(
  recipientId: number,
  hospitalId: number,
  over: Partial<{ blood_group_needed: string; units_required: number; urgency_level: string; request_date: string }> = {},
) {
  const [r] = await (await db()).query(
    "INSERT INTO Blood_Request (recipient_id, hospital_id, blood_group_needed, units_required, urgency_level, request_date) VALUES (?,?,?,?,?,COALESCE(?, CURDATE()))",
    [recipientId, hospitalId, over.blood_group_needed ?? "O+", over.units_required ?? 2, over.urgency_level ?? "Medium", over.request_date ?? null],
  );
  return (r as { insertId: number }).insertId;
}

export const TEST_PASSWORD = "Test@12345";

export async function makeStaff(hospitalId: number, email?: string): Promise<SessionUser> {
  const n = next();
  const address = email ?? `staff${n}@test.example`;
  const [r] = await (await db()).query(
    "INSERT INTO App_User (email, password_hash, display_name, role, hospital_id) VALUES (?,?,?,'STAFF',?)",
    [address, await bcrypt.hash(TEST_PASSWORD, 4), `Staff ${n}`, hospitalId],
  );
  return { user_id: (r as { insertId: number }).insertId, email: address, display_name: `Staff ${n}`, role: "STAFF", hospital_id: hospitalId, donor_id: null };
}

export async function makeDonorUser(donorId: number, email?: string): Promise<SessionUser> {
  const n = next();
  const address = email ?? `donor${n}@test.example`;
  const [r] = await (await db()).query(
    "INSERT INTO App_User (email, password_hash, display_name, role, donor_id) VALUES (?,?,?,'DONOR',?)",
    [address, await bcrypt.hash(TEST_PASSWORD, 4), `Donor User ${n}`, donorId],
  );
  return { user_id: (r as { insertId: number }).insertId, email: address, display_name: `Donor User ${n}`, role: "DONOR", hospital_id: null, donor_id: donorId };
}

/** A hospital with one staff member, one recipient and one open request. */
export async function scenario(over: { group?: string; units?: number; urgency?: string; city?: string } = {}) {
  const hospitalId = await makeHospital({ city: over.city });
  const staff = await makeStaff(hospitalId);
  const recipientId = await makeRecipient(hospitalId, { blood_group: over.group ?? "O+" });
  const requestId = await makeRequest(recipientId, hospitalId, {
    blood_group_needed: over.group ?? "O+",
    units_required: over.units ?? 2,
    urgency_level: over.urgency,
  });
  return { hospitalId, staff, recipientId, requestId };
}

export const requestState = (id: number) =>
  q1<{ status: string; units_required: number; units_fulfilled: number }>(
    "SELECT status, units_required, units_fulfilled FROM Blood_Request WHERE request_id = ?",
    [id],
  );
