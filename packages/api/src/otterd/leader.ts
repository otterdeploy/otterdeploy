import { Result } from "better-result";
/**
 * One scheduler per install. Every control-plane process runs the hub, but
 * only the holder of a Postgres session advisory lock plans and acts. The
 * lock lives on a dedicated connection: if that connection or the process
 * dies, Postgres releases it and another process takes over on its next try.
 * A leader re-checks the lock before every pass and stops at the first doubt;
 * the store's transactions re-check every rule anyway, so a stale pass can
 * only be refused, never applied.
 */
import { SQL } from "bun";
import * as z from "zod";

/** The scheduler lock's key (below 2^31, so pg_locks shows it as objid with classid 0). */
const LOCK_KEY = 741_209_331;

const row = z.object({ held: z.boolean() });

export class Leadership {
  private conn: SQL | null = null;
  private held = false;

  constructor(private readonly url: string) {}

  /** Try to become (or stay) the leader. Never throws. */
  async check(): Promise<boolean> {
    const r = await Result.tryPromise({
      try: async () => {
        this.conn ??= new SQL({ url: this.url, max: 1, idleTimeout: 0 });
        const sql = this.held
          ? `select exists(select 1 from pg_locks where locktype = 'advisory' and classid = 0 and objid = ${LOCK_KEY} and pid = pg_backend_pid() and granted) as held`
          : `select pg_try_advisory_lock(${LOCK_KEY}) as held`;
        const rows: unknown = await this.conn.unsafe(sql);
        const parsed = z.array(row).parse(rows);
        return parsed[0]?.held ?? false;
      },
      catch: (e) => e,
    });
    if (r.isErr()) {
      // A broken connection has already released the lock on the server side.
      await this.reset();
      return false;
    }
    this.held = r.value;
    return this.held;
  }

  /** Give leadership up (shutdown): closing the connection releases the lock. */
  release(): Promise<void> {
    return this.reset();
  }

  private async reset(): Promise<void> {
    this.held = false;
    const conn = this.conn;
    this.conn = null;
    if (conn) await Result.tryPromise({ try: () => conn.close(), catch: () => null });
  }
}
