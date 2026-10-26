import { afterAll, describe, expect, it } from "vitest";
import { closePool, getPool, one, withTransaction } from "@/lib/mysql";
import { closeAll, q1 } from "../helpers";

afterAll(async () => {
  await closePool();
  await closeAll();
});

describe("one application time zone", () => {
  it("every pooled MySQL session runs in APP_TIMEZONE, whatever the server default is", async () => {
    const expected = process.env.APP_TIMEZONE || "+05:30";
    const sessions = await Promise.all(Array.from({ length: 6 }, () => one<{ tz: string }>(getPool(), "SELECT @@session.time_zone AS tz")));
    expect(sessions.map((s) => s?.tz)).toEqual(Array(6).fill(expected));
    const inTx = await withTransaction((conn) => one<{ tz: string }>(conn, "SELECT @@session.time_zone AS tz"));
    expect(inTx?.tz).toBe(expected);
  });

  it("the application and the test fixtures agree on today's date", async () => {
    const app = await one<{ d: string }>(getPool(), "SELECT CURDATE() AS d");
    expect(app?.d).toBe((await q1<{ d: string }>("SELECT CURDATE() AS d")).d);
  });
});
