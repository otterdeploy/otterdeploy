import { project } from "@otterdeploy/db/schema/project";
import { ID_PREFIX, zSlug } from "@otterdeploy/shared/id";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vite-plus/test";

/**
 * `manifest.apply` answered SUCCESS with `appliedCount: 0` and
 * nothing skipped, right after a successful `manifest.save` (vikunja,
 * teslamate and paperless each needed four applies; 5 of 16 concurrent
 * stage-and-apply calls did it). The apply read the manifest through the
 * Redis query cache, which still held the EMPTY manifest from before the save,
 * and an empty manifest applies nothing.
 *
 * Two causes, both pinned here against a real Redis (INTEGRATION_REDIS_URL;
 * the file skips without one):
 *   1. The manifest is the optimistic-locked document every save, diff and
 *      apply starts from, and it was served from the cache. However the stale
 *      entry got there, a read must not return it.
 *   2. How it got there: a put racing an invalidation lost its index entry
 *      (SET, then the other side's SUNION + DEL of the whole index set, then
 *      the SADD), so the value survived every later invalidation for its TTL.
 *      Put and invalidate are each one Redis script now.
 */
import type { Manifest } from "../../../stack/manifest";

const redisUrl = vi.hoisted(() => {
  /* oxlint-disable node/no-process-env -- test env boundary: the query cache under test needs the opt-in integration Redis */
  const url = process.env.INTEGRATION_REDIS_URL;
  if (url) process.env.REDIS_URL = url;
  /* oxlint-enable node/no-process-env */
  return url;
});

const { db } = await import("@otterdeploy/db");
const { RedisCache } = await import("@otterdeploy/db/cache");
const { cacheRedisCircuit } = await import("@otterdeploy/db/redis-circuit");
const { seedOrganization, seedProject } = await import("../../../__tests__/postgres-seed");
const { loadManifest, saveManifest } = await import("../manifest");

describe.skipIf(!redisUrl)("manifest reads with the query cache on", () => {
  it("apply's read sees the manifest that was just saved, never a cached empty one", async () => {
    const organizationId = await seedOrganization("fresh-manifest");
    const { projectId, slug } = await seedProject(organizationId);
    const scope = { projectId, organizationId };

    const before = await loadManifest(scope);
    expect(before.isOk() && before.value.manifest).toBeNull();

    // A write the cache never hears about: exactly what a lost invalidation
    // leaves behind (the stored row moved on, the cached copy did not).
    const manifest = {
      project: zSlug(ID_PREFIX.project).parse(slug),
      services: { web: { source: "image", image: "traefik/whoami:v1.10" } },
      databases: {},
      composes: {},
    } satisfies Manifest;
    await db.execute(
      sql`update ${project} set manifest = (${JSON.stringify(manifest)}::text)::jsonb, manifest_version = manifest_version + 1 where ${eq(project.id, projectId)}`,
    );

    const after = await loadManifest(scope);
    if (after.isErr()) throw after.error;
    expect(after.value.manifest?.services.web).toBeDefined();
    expect(after.value.version).toBe((before.isOk() ? before.value.version : -1) + 1);

    // And the normal path: save, then read.
    const saved = await saveManifest(scope, {
      manifest: { ...manifest, services: {} },
      expectedVersion: after.value.version,
    });
    expect(saved.isOk()).toBe(true);
    const reread = await loadManifest(scope);
    expect(reread.isOk() && Object.keys(reread.value.manifest?.services ?? {})).toEqual([]);
  });
});

describe.skipIf(!redisUrl)("RedisCache put and invalidation", () => {
  const response = (tag: string) => [{ id: tag }];

  /** A fresh client rejects commands until it has connected (the cache runs
   *  with the offline queue off, so it degrades to a miss instead of waiting).
   *  Each of those rejections also opens the shared Redis circuit, which would
   *  skip the next put outright, so every attempt starts with it closed. */
  async function connectedCache(): Promise<InstanceType<typeof RedisCache>> {
    const cache = new RedisCache({ global: true, ttl: 60 });
    for (let attempt = 0; attempt < 100; attempt++) {
      await cacheRedisCircuit.run("reset", async () => undefined, { force: true });
      await cache.put("warm-up", response("warm"), [], false);
      if ((await cache.get("warm-up", [], false)) !== undefined) return cache;
      await Bun.sleep(20);
    }
    throw new Error("the integration Redis never accepted a command");
  }

  it("an invalidation of a table drops every entry indexed under it", async () => {
    const cache = await connectedCache();
    const table = `t_${crypto.randomUUID()}`;
    await cache.put("k-one", response("one"), [table], false);
    expect(await cache.get("k-one", [table], false)).toEqual(response("one"));
    await cache.onMutate({ tables: [table] });
    expect(await cache.get("k-one", [table], false)).toBeUndefined();
  });

  it("puts racing invalidations never leave an entry no later invalidation can reach", async () => {
    // Two connections, so the commands genuinely interleave on the server.
    const writer = await connectedCache();
    const invalidator = await connectedCache();
    const table = `t_${crypto.randomUUID()}`;
    const keys = Array.from({ length: 200 }, (_, i) => `race-${table}-${i}`);
    // One pair at a time, so each put races exactly one invalidation.
    for (const key of keys) {
      await Promise.all([
        writer.put(key, response(key), [table], false),
        invalidator.onMutate({ tables: [table] }),
      ]);
    }
    // Whatever survived the race must be reachable by the next invalidation.
    await invalidator.onMutate({ tables: [table] });
    const survivors = (
      await Promise.all(keys.map((key) => writer.get(key, [table], false)))
    ).filter((v) => v !== undefined);
    expect(survivors).toEqual([]);
  });
});
