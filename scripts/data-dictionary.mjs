#!/usr/bin/env node
/**
 * Prints the data dictionary as Markdown, read from the LIVE database
 * (information_schema), so the documentation cannot drift from the schema.
 *   node scripts/data-dictionary.mjs > docs/DATA_DICTIONARY.md
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env.local"), quiet: true });
const db = process.env.MYSQL_DATABASE;
const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_ADMIN_USER || process.env.MYSQL_USER,
  password: process.env.MYSQL_ADMIN_PASSWORD || process.env.MYSQL_PASSWORD,
});
const q = async (sql, params = []) => (await conn.query(sql, params))[0];

const DESCRIPTIONS = {
  Hospital: "A hospital or blood bank that registers recipients, raises requests and hosts donations.",
  Donor: "A person who can donate blood.",
  Recipient: "A patient who needs blood, registered at one hospital.",
  Blood_Request: "A request for a number of units of one blood group for a recipient, with an urgency level.",
  Donation: "One donation by one donor at one hospital, optionally fulfilling a request.",
  Compatibility: "Reference table: which donor blood group can be given to which recipient blood group (all 64 pairs).",
  App_User: "Login accounts. STAFF belongs to a hospital, DONOR is linked to one donor.",
  Activity_Outbox: "Activity events waiting to be copied to MongoDB (written in the same transaction as the change).",
};
const ORDER = Object.keys(DESCRIPTIONS);
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|");

console.log("# Data dictionary\n");
console.log("Generated from the live MySQL schema by `node scripts/data-dictionary.mjs`. Do not edit by hand.\n");

for (const table of ORDER) {
  console.log(`## ${table}\n\n${DESCRIPTIONS[table]}\n`);
  const cols = await q(
    `SELECT column_name AS name, column_type AS type, is_nullable AS nullable, column_default AS def, column_key AS k, extra AS extra
       FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
    [db, table],
  );
  const fks = await q(
    `SELECT k.column_name AS col, k.referenced_table_name AS rt, k.referenced_column_name AS rc, r.delete_rule AS del, r.update_rule AS upd
       FROM information_schema.key_column_usage k
       JOIN information_schema.referential_constraints r
         ON r.constraint_schema = k.constraint_schema AND r.constraint_name = k.constraint_name
      WHERE k.table_schema = ? AND k.table_name = ? AND k.referenced_table_name IS NOT NULL`,
    [db, table],
  );
  console.log("| Column | Type | Null | Default | Key / reference |");
  console.log("|---|---|---|---|---|");
  for (const c of cols) {
    const fk = fks.find((f) => f.col === c.name);
    const key = [
      c.k === "PRI" ? "PK" : c.k === "UNI" ? "UNIQUE" : "",
      /auto_increment/.test(c.extra) ? "AUTO_INCREMENT" : "",
      fk ? `FK → ${fk.rt}.${fk.rc} (ON DELETE ${fk.del}, ON UPDATE ${fk.upd})` : "",
    ].filter(Boolean).join(", ");
    console.log(`| \`${c.name}\` | \`${esc(c.type)}\` | ${c.nullable === "YES" ? "yes" : "no"} | ${c.def === null ? "" : `\`${esc(c.def)}\``} | ${key} |`);
  }
  const checks = await q(
    `SELECT t.constraint_name AS name, c.check_clause AS clause
       FROM information_schema.table_constraints t
       JOIN information_schema.check_constraints c
         ON c.constraint_schema = t.constraint_schema AND c.constraint_name = t.constraint_name
      WHERE t.table_schema = ? AND t.table_name = ? AND t.constraint_type = 'CHECK' ORDER BY t.constraint_name`,
    [db, table],
  );
  if (checks.length) {
    console.log("\nCHECK constraints:\n");
    for (const c of checks) console.log(`- \`${c.name}\`: \`\` ${esc(c.clause).replace(/_utf8mb4/g, "").replace(/\\'/g, "'")} \`\``);
  }
  const idx = await q(
    `SELECT index_name AS name, index_type AS type, non_unique AS nu, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS cols
       FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? GROUP BY index_name, index_type, non_unique ORDER BY index_name`,
    [db, table],
  );
  console.log("\nIndexes:\n");
  for (const i of idx) console.log(`- \`${i.name}\` (${i.type === "FULLTEXT" ? "FULLTEXT" : Number(i.nu) ? "index" : "unique"}): ${i.cols}`);
  const trg = await q(
    "SELECT trigger_name AS name, action_timing AS t, event_manipulation AS e FROM information_schema.triggers WHERE trigger_schema = ? AND event_object_table = ? ORDER BY trigger_name",
    [db, table],
  );
  if (trg.length) {
    console.log("\nTriggers:\n");
    for (const t of trg) console.log(`- \`${t.name}\` (${t.t} ${t.e})`);
  }
  console.log("");
}
await conn.end();
