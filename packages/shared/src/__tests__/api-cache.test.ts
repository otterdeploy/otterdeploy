import { describe, expect, test } from "bun:test";

import { apiCacheHashFromDataKey, createApiCacheIdentity, getRouteHash } from "../api-cache";

const sharedScope = ["org_acme", "prj_console", "env_production", 1] as const;

describe("getRouteHash", () => {
  test("accepts ordered string and number parts", async () => {
    const route = await getRouteHash(["org_acme", 42, "env_production"]);
    expect(route.canonical).toBe('["org_acme",42,"env_production"]');
    expect(route.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("createApiCacheIdentity", () => {
  test("is stable for an organization-uniform project environment", async () => {
    const identity = await createApiCacheIdentity({
      endpoint: "project.resource.list",
      scope: sharedScope,
    });

    expect(identity.canonical).toBe(
      '["otterdeploy-api-cache","project.resource.list",1,"org_acme","prj_console","env_production",1]',
    );
    expect(identity.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.dataKey).toBe(`api:cache:project.resource.list:v1:${identity.hash}`);
    expect(identity.eventChannel).toBe(`api:cache:events:${identity.hash}`);
    expect(apiCacheHashFromDataKey(identity.dataKey)).toBe(identity.hash);
    expect(apiCacheHashFromDataKey(identity.eventChannel)).toBeNull();
  });

  test("changes when any response-affecting scope changes", async () => {
    const base = await createApiCacheIdentity({
      endpoint: "project.resource.list",
      scope: sharedScope,
    });
    const changed = await Promise.all([
      createApiCacheIdentity({
        endpoint: "project.resource.list",
        scope: ["org_other", "prj_console", "env_production", 1],
      }),
      createApiCacheIdentity({
        endpoint: "project.resource.list",
        scope: ["org_acme", "prj_other", "env_production", 1],
      }),
      createApiCacheIdentity({
        endpoint: "project.resource.list",
        scope: ["org_acme", "prj_console", "env_staging", 0],
      }),
    ]);

    for (const identity of changed) expect(identity.hash).not.toBe(base.hash);
  });

  test("only separates users when the route includes userId", async () => {
    const alice = await createApiCacheIdentity({
      endpoint: "user.notification.list",
      scope: ["org_acme", "usr_alice"],
    });
    const bob = await createApiCacheIdentity({
      endpoint: "user.notification.list",
      scope: ["org_acme", "usr_bob"],
    });

    expect(alice.hash).not.toBe(bob.hash);
  });
});
