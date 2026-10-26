import { connection } from "next/server";
import { ok } from "@/lib/http";
import { getPool } from "@/lib/mysql";
import { getMongoDb } from "@/lib/mongo";

/** Liveness of both databases (no data, no credentials). */
export async function GET() {
  await connection();
  const status = { mysql: "down", mongodb: "down" };
  try {
    await getPool().query("SELECT 1");
    status.mysql = "up";
  } catch {}
  try {
    await getMongoDb().command({ ping: 1 });
    status.mongodb = "up";
  } catch {}
  const healthy = status.mysql === "up" && status.mongodb === "up";
  return ok(status, { status: healthy ? 200 : 503 });
}
