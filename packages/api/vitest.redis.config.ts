/**
 * The half of this package's suite that needs a real Redis.
 *
 * Runs in CI's `integration` job (which owns the service containers), not the
 * fast `test` leg. Kept as its own config rather than a runtime skip so the
 * split is declared in one place and a file cannot quietly opt itself out.
 *
 * What lives here is anything asserting behaviour Redis itself provides — TTL
 * eviction, `GETDEL` atomicity under a race, `SET NX` refusing to clobber. An
 * in-memory double can imitate those, but a double that imitates them is only
 * testing the double: the ticket suite exists to prove a replayed terminal
 * credential fails, and that guarantee lives in Redis's semantics, not ours.
 * Contrast apps/server's ws.test.ts, which asserts the HANDLER's rejection
 * paths and is correctly served by a double.
 */
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.redis.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
