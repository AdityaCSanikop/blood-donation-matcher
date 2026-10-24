#!/usr/bin/env node
/**
 * Database setup tool.
 *
 *   node scripts/db.mjs setup  [--seed] [--env test]   create DB (if missing) + schema
 *   node scripts/db.mjs seed            [--env test]   load demo data + demo logins
 *   node scripts/db.mjs reset --yes [--seed] [--env test]   DROP everything, rebuild
 *   node scripts/db.mjs status          [--env test]   show what exists
 *   node scripts/db.mjs create-staff --email a@b.c --password "..." --name "..." --hospital "Hospital name" --city "City" --phone 0801234567
 *                                                      first login for a real (non-demo) installation
 *
 * Reads connection settings from .env.local (or .env.test with --env test).
 * Uses MYSQL_ADMIN_USER / MYSQL_ADMIN_PASSWORD when set (schema changes need
 * more privileges than the web app's own account), otherwise MYSQL_USER.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const command = args[0];
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const envName = option("env");
const envFile = envName ? `.env.${envName}` : ".env.local";
if (fs.existsSync(path.join(root, envFile))) {
  dotenv.config({ path: path.join(root, envFile), quiet: true });
} else if (!process.env.MYSQL_DATABASE) {
  console.error(`Missing ${envFile}. Copy .env.example to ${envFile} and fill it in.`);
  process.exit(1);
}

const database = process.env.MYSQL_DATABASE;
if (!/^[A-Za-z0-9_]+$/.test(database ?? "")) {
  console.error("MYSQL_DATABASE must be set and contain only letters, digits and underscores.");
  process.exit(1);
}

const SCHEMA_FILES = [
  "01_schema.sql",
  "02_migration.sql",
  "03_routines.sql",
  "04_views.sql",
  "05_reference_data.sql",
];

/** Split a .sql file into statements, honouring DELIMITER, quotes and comments. */
export function splitSql(text) {
  const statements = [];
  let delimiter = ";";
  let current = "";
  let i = 0;
  const push = () => {
    const s = current.trim();
    if (s) statements.push(s);
    current = "";
  };
  while (i < text.length) {
    const atLineStart = i === 0 || text[i - 1] === "\n";
    if (atLineStart && current.trim() === "") {
      const m = /^DELIMITER[ \t]+(\S+)[ \t]*\r?(\n|$)/i.exec(text.slice(i, i + 40));
      if (m) {
        delimiter = m[1];
        i += m[0].length;
        current = "";
        continue;
      }
    }
    const ch = text[i];
    const two = text.slice(i, i + 2);
    if (two === "--" && /[\s]/.test(text[i + 2] ?? "\n")) {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (ch === "#") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (two === "/*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\" && ch !== "`") { j += 2; continue; }
        if (text[j] === ch) {
          if (text[j + 1] === ch) { j += 2; continue; }
          break;
        }
        j++;
      }
      current += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (text.startsWith(delimiter, i)) {
      push();
      i += delimiter.length;
      continue;
    }
    current += ch;
    i++;
  }
  push();
  return statements;
}

async function runFile(conn, file) {
  const text = fs.readFileSync(path.join(root, "sql", file), "utf8");
  const statements = splitSql(text);
  for (const sql of statements) {
    try {
      await conn.query(sql);
    } catch (err) {
      console.error(`\n✗ ${file} failed on:\n${sql.slice(0, 400)}\n→ ${err.message}`);
      throw err;
    }
  }
  console.log(`  ✓ ${file}  (${statements.length} statements)`);
}

async function connect(withDatabase) {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST ?? "127.0.0.1",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_ADMIN_USER || process.env.MYSQL_USER,
    password: process.env.MYSQL_ADMIN_PASSWORD || process.env.MYSQL_PASSWORD,
    database: withDatabase ? database : undefined,
    dateStrings: true,
  });
  // Same time zone as the application, so the seed's "N days ago" dates line up with it.
  const tz = process.env.APP_TIMEZONE || "+05:30";
  if (!/^[+-]\d{2}:\d{2}$/.test(tz)) throw new Error('APP_TIMEZONE must be a UTC offset like "+05:30".');
  await conn.query("SET time_zone = ?", [tz]);
  return conn;
}

async function tableExists(conn, name) {
  const [rows] = await conn.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ?",
    [database, name],
  );
  return rows.length > 0;
}

async function setup(conn) {
  if (await tableExists(conn, "Hospital")) {
    console.log(`Schema already present in '${database}' — nothing to do. (Use "reset --yes" to rebuild.)`);
    return false;
  }
  console.log(`Creating schema in '${database}':`);
  for (const f of SCHEMA_FILES) await runFile(conn, f);
  return true;
}

async function seed(conn) {
  const [[{ n }]] = await conn.query("SELECT COUNT(*) AS n FROM Hospital");
  if (n > 0) {
    console.log("Demo data not loaded: tables already contain rows.");
    return;
  }
  console.log("Loading demo data:");
  await runFile(conn, "06_seed_demo.sql");

  // Demo logins. Passwords are bcrypt-hashed here; nothing is stored in plain text.
  const password = process.env.SEED_PASSWORD || "Demo@12345";
  const hash = await bcrypt.hash(password, 10);
  const users = [
    ["staff@lakeside.test", "Lakeside Staff", "STAFF", 1, null],
    ["staff@nandihills.test", "Nandi Hills Staff", "STAFF", 2, null],
    ["staff@kaveri.test", "Kaveri Staff", "STAFF", 3, null],
    ["staff@malnad.test", "Malnad Staff", "STAFF", 4, null],
    ["staff@coastalmercy.test", "Coastal Mercy Staff", "STAFF", 5, null],
    ["arjun@donor.test", "Arjun Rao", "DONOR", null, 1],
    ["meera@donor.test", "Meera Nair", "DONOR", null, 2],
    ["kiran@donor.test", "Kiran Shetty", "DONOR", null, 3],
    ["divya@donor.test", "Divya Hegde", "DONOR", null, 4],
    ["rahul@donor.test", "Rahul Gowda", "DONOR", null, 5],
  ];
  for (const [email, name, role, hospitalId, donorId] of users) {
    await conn.query(
      "INSERT INTO App_User (email, password_hash, display_name, role, hospital_id, donor_id) VALUES (?,?,?,?,?,?)",
      [email, hash, name, role, hospitalId, donorId],
    );
  }
  console.log(`  ✓ ${users.length} demo logins (password: ${process.env.SEED_PASSWORD ? "from SEED_PASSWORD" : password})`);
}

async function status(conn) {
  const [tables] = await conn.query(
    "SELECT table_name AS name, table_type AS type, table_rows AS approx_rows FROM information_schema.tables WHERE table_schema = ? ORDER BY table_type, table_name",
    [database],
  );
  console.table(tables);
  const [routines] = await conn.query(
    "SELECT routine_name AS name, routine_type AS type FROM information_schema.routines WHERE routine_schema = ?",
    [database],
  );
  console.table(routines);
  const [triggers] = await conn.query(
    "SELECT trigger_name AS name, event_object_table AS on_table, action_timing AS timing, event_manipulation AS event FROM information_schema.triggers WHERE trigger_schema = ?",
    [database],
  );
  console.table(triggers);
}

/** Creates a hospital (if it does not exist yet) and a staff login for it. */
async function createStaff(conn) {
  const need = (name) => {
    const value = option(name);
    if (!value) throw new Error(`Missing --${name}. See the usage notes at the top of scripts/db.mjs.`);
    return value;
  };
  const email = need("email").toLowerCase();
  const password = need("password");
  if (password.length < 8) throw new Error("--password must be at least 8 characters.");
  const [existing] = await conn.query("SELECT hospital_id FROM Hospital WHERE name = ? AND city = ?", [need("hospital"), need("city")]);
  await conn.beginTransaction();
  try {
    let hospitalId = existing[0]?.hospital_id;
    if (!hospitalId) {
      const [r] = await conn.query("INSERT INTO Hospital (name, city, phone) VALUES (?,?,?)", [need("hospital"), need("city"), need("phone")]);
      hospitalId = r.insertId;
    }
    await conn.query("INSERT INTO App_User (email, password_hash, display_name, role, hospital_id) VALUES (?,?,?,'STAFF',?)", [
      email,
      await bcrypt.hash(password, 10),
      need("name"),
      hospitalId,
    ]);
    await conn.commit();
    console.log(`Staff login ${email} created for hospital #${hospitalId}.`);
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

async function main() {
  if (!["setup", "seed", "reset", "status", "create-staff"].includes(command)) {
    console.log("Usage: node scripts/db.mjs <setup|seed|reset|status|create-staff> [--seed] [--yes] [--env test]");
    process.exit(command ? 1 : 0);
  }
  const server = await connect(false);
  await server.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
  );
  await server.end();

  const conn = await connect(true);
  try {
    if (command === "reset") {
      if (!flag("yes")) {
        console.error(`Refusing to reset '${database}': this deletes ALL its data. Re-run with --yes to confirm.`);
        process.exit(1);
      }
      console.log(`Dropping all project objects in '${database}':`);
      await runFile(conn, "00_drop.sql");
      await setup(conn);
      if (flag("seed")) await seed(conn);
    } else if (command === "setup") {
      await setup(conn);
      if (flag("seed")) await seed(conn);
    } else if (command === "seed") {
      await seed(conn);
    } else if (command === "create-staff") {
      await createStaff(conn);
    } else {
      await status(conn);
    }
  } finally {
    await conn.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
