import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeAll, db, makeDonor, makeHospital, makeRecipient, makeRequest, q, q1, resetData } from "../helpers";

const DB = process.env.MYSQL_DATABASE!;

beforeAll(resetData);
afterAll(closeAll);

describe("schema objects", () => {
  it("has the six core tables plus the two support tables", async () => {
    const tables = await q<{ name: string }>(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'",
      [DB],
    );
    // Windows MySQL (lower_case_table_names=1) stores table names in lower case.
    expect(tables.map((t) => t.name.toLowerCase()).sort()).toEqual(
      ["Activity_Outbox", "App_User", "Blood_Request", "Compatibility", "Donation", "Donor", "Hospital", "Recipient"].map((n) => n.toLowerCase()).sort(),
    );
  });

  it("has the five reporting views", async () => {
    const views = await q<{ name: string }>("SELECT table_name AS name FROM information_schema.views WHERE table_schema = ?", [DB]);
    expect(views.map((v) => v.name).sort()).toEqual(
      ["vw_blood_group_overview", "vw_donation_history", "vw_donor_eligibility", "vw_hospital_donation_stats", "vw_request_queue"].sort(),
    );
  });

  it("has the stored procedures and functions", async () => {
    const routines = await q<{ name: string; type: string }>(
      "SELECT routine_name AS name, routine_type AS type FROM information_schema.routines WHERE routine_schema = ? ORDER BY routine_name",
      [DB],
    );
    expect(routines).toEqual([
      { name: "fn_is_donor_eligible", type: "FUNCTION" },
      { name: "fn_request_status", type: "FUNCTION" },
      { name: "sp_match_donors", type: "PROCEDURE" },
      { name: "sp_record_donation", type: "PROCEDURE" },
    ]);
  });

  it("has the six triggers", async () => {
    const triggers = await q<{ name: string }>("SELECT trigger_name AS name FROM information_schema.triggers WHERE trigger_schema = ?", [DB]);
    expect(triggers.map((t) => t.name).sort()).toEqual([
      "trg_donation_after_delete",
      "trg_donation_after_insert",
      "trg_donation_before_insert",
      "trg_donation_before_update",
      "trg_request_before_insert",
      "trg_request_before_update",
    ]);
  });

  it("has the designed indexes, including the FULLTEXT one, and dropped the Week 4 ones", async () => {
    const idx = await q<{ name: string; tbl: string; type: string }>(
      "SELECT DISTINCT index_name AS name, table_name AS tbl, index_type AS type FROM information_schema.statistics WHERE table_schema = ?",
      [DB],
    );
    const names = idx.map((i) => i.name);
    for (const expected of ["idx_donor_match", "idx_request_queue", "idx_donation_donor", "idx_donation_hospital_date", "ft_donor_name_city", "uq_donor_phone"]) {
      expect(names).toContain(expected);
    }
    expect(names).not.toContain("idx_donor_bg_avail");
    expect(names).not.toContain("idx_request_urgency");
    expect(idx.find((i) => i.name === "ft_donor_name_city")?.type).toBe("FULLTEXT");
  });

  it("the migration added Blood_Request.hospital_id (NOT NULL, FK) and units_fulfilled", async () => {
    const cols = await q<{ name: string; nullable: string }>(
      "SELECT column_name AS name, is_nullable AS nullable FROM information_schema.columns WHERE table_schema = ? AND table_name = 'Blood_Request'",
      [DB],
    );
    expect(cols.find((c) => c.name === "hospital_id")?.nullable).toBe("NO");
    expect(cols.find((c) => c.name === "units_fulfilled")?.nullable).toBe("NO");
    const fks = await q<{ name: string; del: string }>(
      "SELECT constraint_name AS name, delete_rule AS del FROM information_schema.referential_constraints WHERE constraint_schema = ?",
      [DB],
    );
    const byName = Object.fromEntries(fks.map((f) => [f.name, f.del]));
    expect(byName.fk_request_hospital).toBe("RESTRICT");
    expect(byName.fk_donation_donor).toBe("RESTRICT"); // was CASCADE in Week 4
    expect(byName.fk_request_recipient).toBe("RESTRICT"); // was CASCADE in Week 4
    expect(byName.fk_donation_request).toBe("SET NULL");
  });
});

describe("Compatibility reference data", () => {
  // Hand-written red-cell compatibility chart, independent of the SQL that generates the table.
  const CAN_GIVE_TO: Record<string, string[]> = {
    "O-": ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"],
    "O+": ["O+", "A+", "B+", "AB+"],
    "A-": ["A-", "A+", "AB-", "AB+"],
    "A+": ["A+", "AB+"],
    "B-": ["B-", "B+", "AB-", "AB+"],
    "B+": ["B+", "AB+"],
    "AB-": ["AB-", "AB+"],
    "AB+": ["AB+"],
  };

  it("contains all 64 donor/recipient pairs, 27 of them compatible", async () => {
    const row = await q1<{ total: number; yes: number }>("SELECT COUNT(*) AS total, SUM(is_compatible) AS yes FROM Compatibility");
    expect(Number(row.total)).toBe(64);
    expect(Number(row.yes)).toBe(27);
  });

  it("matches the standard chart for every one of the 64 pairs", async () => {
    const rows = await q<{ d: string; r: string; ok: number }>(
      "SELECT donor_blood_group AS d, recipient_blood_group AS r, is_compatible AS ok FROM Compatibility",
    );
    for (const row of rows) {
      expect(Boolean(row.ok), `${row.d} -> ${row.r}`).toBe(CAN_GIVE_TO[row.d].includes(row.r));
    }
  });

  it("O- is the universal donor and AB+ the universal recipient", async () => {
    const o = await q1<{ n: number }>("SELECT COUNT(*) AS n FROM Compatibility WHERE donor_blood_group = 'O-' AND is_compatible");
    const ab = await q1<{ n: number }>("SELECT COUNT(*) AS n FROM Compatibility WHERE recipient_blood_group = 'AB+' AND is_compatible");
    expect(Number(o.n)).toBe(8);
    expect(Number(ab.n)).toBe(8);
  });
});

describe("constraints reject bad data at the database level", () => {
  const insert = async (sql: string, params: unknown[]) => (await db()).query(sql, params);
  let hospitalId: number;
  let recipientId: number;

  beforeAll(async () => {
    hospitalId = await makeHospital();
    recipientId = await makeRecipient(hospitalId);
  });

  it("rejects an unknown blood group (ENUM)", async () => {
    await expect(insert("INSERT INTO Donor (name, blood_group, phone, city) VALUES (?,?,?,?)", ["X Y", "C+", "9111111111", "Mysuru"])).rejects.toMatchObject({
      errno: 1265,
    });
  });

  it("rejects a malformed phone number (CHECK)", async () => {
    await expect(insert("INSERT INTO Donor (name, blood_group, phone, city) VALUES (?,?,?,?)", ["X Y", "O+", "12-ab", "Mysuru"])).rejects.toMatchObject({
      errno: 3819,
    });
  });

  it("rejects a blank donor name (CHECK)", async () => {
    await expect(insert("INSERT INTO Donor (name, blood_group, phone, city) VALUES (?,?,?,?)", [" ", "O+", "9111111112", "Mysuru"])).rejects.toMatchObject({
      errno: 3819,
    });
  });

  it("rejects a duplicate donor phone (UNIQUE)", async () => {
    await makeDonor({ phone: "9222222222" });
    await expect(makeDonor({ phone: "9222222222" })).rejects.toMatchObject({ errno: 1062 });
  });

  it("rejects recipient age 0 and 121 (CHECK)", async () => {
    for (const age of [0, 121]) {
      await expect(
        insert("INSERT INTO Recipient (name, blood_group, age, hospital_id) VALUES (?,?,?,?)", ["Pat Ient", "O+", age, hospitalId]),
      ).rejects.toMatchObject({ errno: 3819 });
    }
  });

  it("rejects a recipient at a hospital that does not exist (FOREIGN KEY)", async () => {
    await expect(insert("INSERT INTO Recipient (name, blood_group, age, hospital_id) VALUES (?,?,?,?)", ["Pat Ient", "O+", 30, 999999])).rejects.toMatchObject({
      errno: 1452,
    });
  });

  it("rejects units_required of 0 and of 21 (CHECK)", async () => {
    for (const units of [0, 21]) {
      await expect(makeRequest(recipientId, hospitalId, { units_required: units })).rejects.toMatchObject({ errno: 3819 });
    }
  });

  it("rejects a donation of 0 or 3 units (CHECK)", async () => {
    const donorId = await makeDonor();
    for (const units of [0, 3]) {
      await expect(
        insert("INSERT INTO Donation (donor_id, hospital_id, donation_date, units_donated) VALUES (?,?,CURDATE(),?)", [donorId, hospitalId, units]),
      ).rejects.toMatchObject({ errno: 3819 });
    }
  });

  it("refuses to delete a hospital that still has recipients (ON DELETE RESTRICT)", async () => {
    await expect(insert("DELETE FROM Hospital WHERE hospital_id = ?", [hospitalId])).rejects.toMatchObject({ errno: 1451 });
  });

  it("refuses to delete a donor who has donations (history is preserved)", async () => {
    const donorId = await makeDonor();
    await insert("INSERT INTO Donation (donor_id, hospital_id, donation_date, units_donated) VALUES (?,?,CURDATE(),1)", [donorId, hospitalId]);
    await expect(insert("DELETE FROM Donor WHERE donor_id = ?", [donorId])).rejects.toMatchObject({ errno: 1451 });
  });

  it("requires a STAFF user to have a hospital and a DONOR user to have a donor (CHECK)", async () => {
    const hash = "$2b$04$" + "a".repeat(53);
    await expect(
      insert("INSERT INTO App_User (email, password_hash, display_name, role) VALUES (?,?,?,'STAFF')", ["s@test.example", hash, "No Hospital"]),
    ).rejects.toMatchObject({ errno: 3819 });
    await expect(
      insert("INSERT INTO App_User (email, password_hash, display_name, role, hospital_id) VALUES (?,?,?,'DONOR',?)", ["d@test.example", hash, "Wrong Link", hospitalId]),
    ).rejects.toMatchObject({ errno: 3819 });
  });

  it("refuses to store a password that is not a bcrypt hash (CHECK)", async () => {
    await expect(
      insert("INSERT INTO App_User (email, password_hash, display_name, role, hospital_id) VALUES (?,?,?,'STAFF',?)", [
        "plain@test.example",
        "plaintext-password",
        "Plain",
        hospitalId,
      ]),
    ).rejects.toMatchObject({ errno: 3819 });
  });
});
