/**
 * A blackholed Redis (packets dropped, no RST) must cost a request at most one
 * cache deadline, not one per Redis command. `service.get` took 12.2 s per call
 * under a Redis blackhole: each select's cache GET, SET and index update waited
 * out its own 2 s, and the response cache's GET had no deadline at all.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

/** A Redis client whose every command is sent into the void. */
function blackholedRedis() {
  const never = () =>
    new Promise<never>(() => {
      // dropped on the wire: never answers
    });
  return {
    get: vi.fn(never),
    set: vi.fn(never),
    sadd: vi.fn(never),
    expire: vi.fn(never),
    del: vi.fn(never),
    sunion: vi.fn(never),
    publish: vi.fn(never),
    // The query cache's put and invalidation each run as one EVAL script.
    send: vi.fn(never),
  };
}

const fakes = vi.hoisted((): { redis: unknown } => ({ redis: null }));
vi.mock("../redis", () => ({ createRedis: () => fakes.redis }));

import { RedisCache } from "@otterdeploy/db/cache";
import {
  cacheRedisCircuit,
  REDIS_CIRCUIT_OPEN_MS,
  REDIS_OP_TIMEOUT_MS,
  RedisCircuit,
  RedisCircuitOpenError,
} from "@otterdeploy/db/redis-circuit";
import { createApiCacheIdentity } from "@otterdeploy/shared/api-cache";
import * as z from "zod";

import { readApiCache, writeApiCache } from "../api-cache";

let redis = blackholedRedis();

beforeEach(async () => {
  vi.useFakeTimers();
  redis = blackholedRedis();
  fakes.redis = redis;
  // Close the shared circuit left open by a previous test.
  await cacheRedisCircuit.run("reset", async () => undefined, { force: true });
});
afterEach(() => {
  vi.useRealTimers();
});

/** Settle `promise` under fake timers, returning how much fake time it took
 *  (in 100 ms steps; 0 = settled without any timer firing). */
async function timed<T>(promise: Promise<T>): Promise<{ value: T; ms: number }> {
  const settled: { outcome: { value: T } | null } = { outcome: null };
  void promise.then((value) => {
    settled.outcome = { value };
  });
  await vi.advanceTimersByTimeAsync(0);
  let ms = 0;
  while (settled.outcome === null && ms < 10_000) {
    await vi.advanceTimersByTimeAsync(100);
    ms += 100;
  }
  if (settled.outcome === null) throw new Error("did not settle within 10 s of fake time");
  return { value: settled.outcome.value, ms };
}

describe("response cache under a blackholed Redis", () => {
  test("a read is a miss within the deadline, and the next calls skip Redis at once", async () => {
    const identity = await createApiCacheIdentity({ endpoint: "service.get", scope: ["org_a"] });
    const schema = z.object({ value: z.string() });

    const first = await timed(readApiCache(identity, schema));
    expect(first.value).toBeUndefined();
    expect(first.ms).toBeLessThanOrEqual(REDIS_OP_TIMEOUT_MS + 100);

    const write = await timed(
      writeApiCache(identity, { value: "fresh" }, { ttlSeconds: 10, dependencyTables: ["x"] }),
    );
    const second = await timed(readApiCache(identity, schema));
    expect(write.ms).toBe(0);
    expect(second.ms).toBe(0);
    expect(redis.get).toHaveBeenCalledTimes(1);
    expect(redis.set).not.toHaveBeenCalled();
  });
});

describe("query cache under a blackholed Redis", () => {
  test("one select's GET + SET + index update cost one deadline, not three", async () => {
    const cache = new RedisCache({ ttl: 60, global: true });
    Reflect.set(cache, "client", redis);

    const get = await timed(cache.get("k", ["resource"]));
    const put = await timed(cache.put("k", [{ id: 1 }], ["resource"]));
    expect(get.value).toBeUndefined();
    expect(get.ms + put.ms).toBeLessThanOrEqual(REDIS_OP_TIMEOUT_MS + 100);
    // The GET script hung; the put was skipped outright by the open circuit.
    expect(redis.send).toHaveBeenCalledTimes(1);
  });

  test("invalidation is still attempted while the circuit is open", async () => {
    const cache = new RedisCache({ ttl: 60, global: true });
    Reflect.set(cache, "client", redis);
    await timed(cache.get("k", ["resource"]));
    expect(cacheRedisCircuit.isOpen).toBe(true);

    await timed(cache.onMutate({ tables: ["resource"] }));
    // One send for the hung GET script, one for the forced invalidation.
    expect(redis.send).toHaveBeenCalledTimes(2);
    expect(redis.send).toHaveBeenLastCalledWith("EVAL", expect.any(Array));
  });
});

describe("RedisCircuit", () => {
  test("opens on a failure, skips while open, and lets one call through after", async () => {
    let clock = 0;
    const circuit = new RedisCircuit({ now: () => clock });
    const failing = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    expect((await circuit.run("op", failing)).isErr()).toBe(true);

    const skipped = await circuit.run("op", failing);
    expect(skipped.isErr() && RedisCircuitOpenError.is(skipped.error)).toBe(true);
    expect(failing).toHaveBeenCalledTimes(1);

    clock += REDIS_CIRCUIT_OPEN_MS;
    const recovered = await circuit.run("op", async () => "PONG");
    expect(recovered.isOk() && recovered.value).toBe("PONG");
    expect(circuit.isOpen).toBe(false);
  });
});
