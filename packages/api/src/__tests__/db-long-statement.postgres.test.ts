/**
 * A statement may run for as long as its own deadline allows; the connection
 * pool must never be the thing that cuts it short (od-8r7r).
 *
 * Bun.SQL's `idleTimeout` and `maxLifetime` are not what their names suggest:
 * both are timers on the connection that fire while a statement is still
 * running on it, failing it with "Idle timeout reached" / "Max lifetime
 * timeout reached". The first describe pins that driver behaviour, so the day
 * Bun changes it this file says so. The second runs a statement longer than
 * the 20 s idle timeout the control-plane pool used to set, through the real
 * `@otterdeploy/db` client: rollup rebuilds, reports and maintenance
 * statements legitimately run that long.
 */
import { db } from "@otterdeploy/db";
import { Result } from "better-result";
import { SQL } from "bun";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

/* oxlint-disable-next-line node/no-process-env -- test env boundary: the throwaway database the global setup created */
const databaseUrl = (): string => process.env.DATABASE_URL ?? "";

async function sleepThrough(options: {
  idleTimeout?: number;
  maxLifetime?: number;
}): Promise<string> {
  const client = new SQL({ url: databaseUrl(), max: 1, ...options });
  try {
    const slept = await Result.tryPromise({
      try: () => client.unsafe("select pg_sleep(2)"),
      catch: (error) => String(error),
    });
    return slept.isOk() ? "completed" : slept.error;
  } finally {
    await client.close();
  }
}

describe("Bun.SQL connection timers abort a running statement", () => {
  it("idleTimeout fires mid-statement", async () => {
    expect(await sleepThrough({ idleTimeout: 1 })).toMatch(/idle timeout/i);
  });

  it("maxLifetime fires mid-statement", async () => {
    expect(await sleepThrough({ maxLifetime: 1 })).toMatch(/max lifetime/i);
  });

  it("with both disabled the statement completes", async () => {
    expect(await sleepThrough({ idleTimeout: 0, maxLifetime: 0 })).toBe("completed");
  });
});

describe("the control-plane pool", () => {
  it("runs a statement longer than the 20 s idle timeout it used to set", async () => {
    const rows = await db.execute<{ done: number }>(sql`select 1 as done from pg_sleep(21)`);
    expect(rows[0]?.done).toBe(1);
  }, 40_000);
});
