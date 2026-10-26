/**
 * Activity logging: MySQL outbox -> MongoDB `activity_logs`.
 *
 * MySQL and MongoDB cannot commit together, so we never write to MongoDB
 * from inside a business transaction. Instead:
 *   1. recordActivity() inserts the event into Activity_Outbox using the SAME
 *      connection/transaction as the business change (atomic with it).
 *   2. After COMMIT, flushOutbox() copies pending rows to MongoDB with an
 *      upsert keyed on event_id (idempotent) and stamps delivered_at.
 *   3. If MongoDB is down the row simply stays pending; the business change
 *      still succeeds and the API reports the log as "queued". Any later
 *      flush (next request, the Reconcile button, or `npm run logs:flush`)
 *      delivers it. Nothing is lost and nothing is duplicated.
 */
import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { getPool, one, rows, run, type Db } from "./mysql";
import { getActivityCollection, type ActivityDoc } from "./mongo";
import { env } from "./env";
import type { SessionUser } from "./auth";

export type ActivityInput = Omit<ActivityDoc, "event_id" | "timestamp" | "performed_by" | "related"> & {
  related?: ActivityDoc["related"];
};

export const SYSTEM_ACTOR = { user_id: null, role: "SYSTEM", email: null };

/** Step 1 — must be called with the transaction's connection. */
export async function recordActivity(conn: PoolConnection, actor: SessionUser | null, input: ActivityInput): Promise<string> {
  const eventId = randomUUID();
  const payload = {
    event_id: eventId,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    action: input.action,
    timestamp: new Date().toISOString(),
    details: input.details,
    performed_by: actor ? { user_id: actor.user_id, role: actor.role, email: actor.email } : SYSTEM_ACTOR,
    related: input.related ?? {},
  };
  await run(conn, "INSERT INTO Activity_Outbox (event_id, payload) VALUES (?, ?)", [eventId, JSON.stringify(payload)]);
  return eventId;
}

export type FlushResult = { delivered: number; pending: number; error: string | null };

type OutboxRow = { outbox_id: number; event_id: string; payload: string | Record<string, unknown> };

/** Step 2 — safe to call at any time, from any number of processes. */
export async function flushOutbox(limit = 200): Promise<FlushResult> {
  const pool = getPool();
  let delivered = 0;
  let error: string | null = null;

  const pendingRows = await rows<OutboxRow>(
    pool,
    "SELECT outbox_id, event_id, payload FROM Activity_Outbox WHERE delivered_at IS NULL ORDER BY outbox_id LIMIT ?",
    [limit],
  );

  if (pendingRows.length > 0) {
    try {
      const logs = await getActivityCollection();
      for (const row of pendingRows) {
        const p = (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) as Omit<ActivityDoc, "timestamp"> & {
          timestamp: string;
        };
        const doc: ActivityDoc = { ...p, timestamp: new Date(p.timestamp) };
        // Upsert on event_id: if a previous attempt reached MongoDB but we
        // crashed before stamping delivered_at, this is a harmless no-op.
        await logs.updateOne({ event_id: doc.event_id }, { $setOnInsert: doc }, { upsert: true });
        await run(pool, "UPDATE Activity_Outbox SET delivered_at = CURRENT_TIMESTAMP(3), last_error = NULL WHERE outbox_id = ?", [
          row.outbox_id,
        ]);
        delivered++;
      }
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 250) : "unknown error";
      const failed = pendingRows[delivered];
      if (failed) {
        await run(pool, "UPDATE Activity_Outbox SET attempts = attempts + 1, last_error = ? WHERE outbox_id = ?", [
          error,
          failed.outbox_id,
        ]).catch(() => {});
      }
    }
  }

  const pending = await pendingCount(pool);
  return { delivered, pending, error };
}

export async function pendingCount(db: Db = getPool()): Promise<number> {
  const row = await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM Activity_Outbox WHERE delivered_at IS NULL");
  return Number(row?.n ?? 0);
}

/** Flush after a commit; never throws, reports how the log ended up. */
export async function flushAfterCommit(): Promise<"delivered" | "queued"> {
  try {
    const result = await flushOutbox();
    return result.pending === 0 ? "delivered" : "queued";
  } catch {
    return "queued";
  }
}

// ---------------------------------------------------------------- reading

export type ActivityFilter = {
  entity_type?: ActivityDoc["entity_type"];
  entity_id?: number;
  action?: string;
  donor_id?: number;
  request_id?: number;
  from?: Date;
  to?: Date;
  limit?: number;
  skip?: number;
};

function buildMatch(f: ActivityFilter): Record<string, unknown> {
  const match: Record<string, unknown> = {};
  if (f.entity_type) match.entity_type = f.entity_type;
  if (f.entity_id !== undefined) match.entity_id = f.entity_id;
  if (f.action) match.action = f.action;
  if (f.donor_id !== undefined) match["related.donor_id"] = f.donor_id;
  if (f.request_id !== undefined) match["related.request_id"] = f.request_id;
  if (f.from || f.to) {
    const range: Record<string, Date> = {};
    if (f.from) range.$gte = f.from;
    if (f.to) range.$lt = f.to;
    match.timestamp = range;
  }
  return match;
}

/** Activity history, newest first (uses idx_entity_history / idx_timestamp). */
export async function findActivity(f: ActivityFilter = {}) {
  const logs = await getActivityCollection();
  const match = buildMatch(f);
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const [items, total] = await Promise.all([
    logs
      .find(match, { projection: { _id: 0 } })
      .sort({ timestamp: -1 })
      .skip(f.skip ?? 0)
      .limit(limit)
      .toArray(),
    logs.countDocuments(match),
  ]);
  return { items, total };
}

export type ActivityStats = {
  granularity: "day" | "week";
  timezone: string;
  total: number;
  by_period: { period: string; total: number; actions: { action: string; count: number }[] }[];
  by_action: { action: string; count: number }[];
  by_entity_type: { entity_type: string; count: number }[];
};

/**
 * NoSQL aggregation (advanced feature): events per day or ISO week, broken
 * down by action, plus overall totals — all in one pipeline with $facet.
 */
export async function activityStats(opts: { granularity?: "day" | "week"; from?: Date; to?: Date } = {}): Promise<ActivityStats> {
  const logs = await getActivityCollection();
  const granularity = opts.granularity ?? "day";
  const timezone = env.timezone;
  // %G-W%V = ISO week-numbering year + ISO week, e.g. 2026-W41
  const format = granularity === "week" ? "%G-W%V" : "%Y-%m-%d";

  const pipeline = [
    { $match: buildMatch({ from: opts.from, to: opts.to }) },
    {
      $facet: {
        by_period: [
          {
            $group: {
              _id: { period: { $dateToString: { format, date: "$timestamp", timezone } }, action: "$action" },
              count: { $sum: 1 },
            },
          },
          { $sort: { "_id.action": 1 } },
          {
            $group: {
              _id: "$_id.period",
              total: { $sum: "$count" },
              actions: { $push: { action: "$_id.action", count: "$count" } },
            },
          },
          { $sort: { _id: 1 } },
          { $project: { _id: 0, period: "$_id", total: 1, actions: 1 } },
        ],
        by_action: [
          { $group: { _id: "$action", count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } },
          { $project: { _id: 0, action: "$_id", count: 1 } },
        ],
        by_entity_type: [
          { $group: { _id: "$entity_type", count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } },
          { $project: { _id: 0, entity_type: "$_id", count: 1 } },
        ],
      },
    },
  ];

  const [result] = (await logs.aggregate(pipeline).toArray()) as unknown as [
    Pick<ActivityStats, "by_period" | "by_action" | "by_entity_type">,
  ];
  const total = result.by_action.reduce((sum, a) => sum + a.count, 0);
  return { granularity, timezone, total, ...result };
}
