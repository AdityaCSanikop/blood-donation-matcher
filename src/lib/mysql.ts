/**
 * MySQL access. A single pooled connection set, parameterised queries only
 * (values are always sent as placeholders, never concatenated into SQL).
 */
import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { env } from "./env";
import { isTransient, toAppError } from "./errors";

const globalForMysql = globalThis as unknown as { __bdmPool?: Pool };

export function getPool(): Pool {
  if (!globalForMysql.__bdmPool) {
    globalForMysql.__bdmPool = mysql.createPool({
      ...env.mysql,
      connectionLimit: 10,
      dateStrings: true, // DATE columns stay 'YYYY-MM-DD' (no timezone shifting)
      decimalNumbers: true, // SUM()/AVG() come back as numbers
      namedPlaceholders: false,
    });
    // Every new session works in the application's time zone (see env.timezone).
    // The offset is validated in env.ts, and commands on a connection run in
    // order, so this always takes effect before the first real query.
    const tz = env.timezone;
    globalForMysql.__bdmPool.pool.on("connection", (conn) => {
      conn.query(`SET time_zone = '${tz}'`);
    });
  }
  return globalForMysql.__bdmPool;
}

export type Db = Pool | PoolConnection;

/**
 * MySQL errors (constraint violations, trigger SIGNALs, ...) become AppErrors
 * with a status code and a readable message. Other errors pass through.
 */
function convert(err: unknown): unknown {
  const e = err as { errno?: unknown; sqlState?: unknown };
  if (typeof e?.errno === "number" && typeof e?.sqlState === "string") {
    const appErr = toAppError(err);
    appErr.cause = err;
    if (appErr.status >= 500) console.error("[mysql] unexpected error:", err);
    return appErr;
  }
  return err;
}
export type SqlValue = string | number | boolean | null | Date;

export async function rows<T = Record<string, unknown>>(db: Db, sql: string, params: SqlValue[] = []): Promise<T[]> {
  try {
    const [result] = await db.query<RowDataPacket[]>(sql, params);
    return result as unknown as T[];
  } catch (err) {
    throw convert(err);
  }
}

export async function one<T = Record<string, unknown>>(db: Db, sql: string, params: SqlValue[] = []): Promise<T | null> {
  const result = await rows<T>(db, sql, params);
  return result[0] ?? null;
}

export async function run(db: Db, sql: string, params: SqlValue[] = []): Promise<ResultSetHeader> {
  try {
    const [result] = await db.query<ResultSetHeader>(sql, params);
    return result;
  } catch (err) {
    throw convert(err);
  }
}

/** First result set of a CALL (mysql2 returns [rows, okPacket]). */
export async function callRows<T = Record<string, unknown>>(db: Db, sql: string, params: SqlValue[] = []): Promise<T[]> {
  try {
    const [result] = await db.query<RowDataPacket[][]>(sql, params);
    return (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : []) as unknown as T[];
  } catch (err) {
    throw convert(err);
  }
}

/**
 * Run `work` in one transaction: COMMIT if it returns, ROLLBACK if it throws.
 * Deadlocks / lock-wait timeouts are retried a few times, because InnoDB
 * resolves a deadlock by rolling one transaction back and asking it to retry.
 */
export async function withTransaction<T>(work: (conn: PoolConnection) => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const result = await work(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      const original = (err as { cause?: unknown })?.cause ?? err;
      if (isTransient(original) && attempt < attempts) continue;
      throw convert(err);
    } finally {
      conn.release();
    }
  }
}

export async function closePool(): Promise<void> {
  if (globalForMysql.__bdmPool) {
    await globalForMysql.__bdmPool.end();
    globalForMysql.__bdmPool = undefined;
  }
}
