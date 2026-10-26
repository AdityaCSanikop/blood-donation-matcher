/**
 * Deliver activity events that are still waiting in the MySQL outbox to
 * MongoDB. Safe to run at any time and as often as you like (idempotent).
 *   npm run logs:flush
 */
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

async function main() {
  const { flushOutbox } = await import("../src/lib/activity");
  const { closePool } = await import("../src/lib/mysql");
  const { closeMongo } = await import("../src/lib/mongo");
  const result = await flushOutbox(5000);
  console.log(`Delivered ${result.delivered}; still pending ${result.pending}${result.error ? `; last error: ${result.error}` : ""}`);
  await closePool();
  await closeMongo();
  process.exit(result.pending === 0 ? 0 : 1);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
