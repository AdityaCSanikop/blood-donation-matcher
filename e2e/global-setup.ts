import { execFileSync } from "node:child_process";
import path from "node:path";
import { MongoClient } from "mongodb";

/** Rebuild the TEST database with the demo data so every run starts identically. */
export default async function globalSetup() {
  if (!/test/i.test(process.env.MYSQL_DATABASE ?? "") || !/test/i.test(process.env.MONGODB_DB ?? "")) {
    throw new Error("Refusing to run: the browser tests must use the test databases from .env.test.");
  }
  const root = path.resolve(__dirname, "..");
  execFileSync(process.execPath, ["scripts/db.mjs", "reset", "--yes", "--seed", "--env", "test"], { cwd: root, stdio: "inherit" });
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.db(process.env.MONGODB_DB).collection("activity_logs").deleteMany({});
  await client.close();
}
