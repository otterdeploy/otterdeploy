/**
 * A Swarm service that writes a mount updates stop-first: two copies of one
 * app must not write the same volume at once (gitea's second copy
 * could not take its LevelDB lock on the shared /data and exited, so every
 * redeploy failed). Stateless services keep start-first.
 */
import { describe, expect, test } from "vite-plus/test";

import type { SwarmServiceSpec } from "../service";

import { buildServiceSpec } from "../internals";

const spec: SwarmServiceSpec = {
  resourceId: "res_1",
  resourceName: "web",
  projectSlug: "gitea",
  serviceName: "gitea-web",
  internalHostname: "web.gitea.internal",
  image: "gitea/gitea:latest",
  env: {},
  replicas: 1,
  restart: { condition: "on-failure", delayMs: 5000 },
  ports: [],
  mounts: [],
  forceUpdateCounter: 0,
};

describe("update order", () => {
  test("a stateless service starts the new task first", () => {
    const built = buildServiceSpec(spec, "otterdeploy-gitea");
    expect(built.UpdateConfig?.Order).toBe("start-first");
    expect(built.RollbackConfig?.Order).toBe("start-first");
  });

  test("a service that writes a volume stops the old task first", () => {
    const built = buildServiceSpec(
      {
        ...spec,
        mounts: [{ Type: "volume", Source: "vol-gitea-data", Target: "/data", ReadOnly: false }],
      },
      "otterdeploy-gitea",
    );
    expect(built.UpdateConfig?.Order).toBe("stop-first");
    expect(built.RollbackConfig?.Order).toBe("stop-first");
  });

  test("read-only mounts do not force a gap", () => {
    const built = buildServiceSpec(
      {
        ...spec,
        mounts: [{ Type: "bind", Source: "/srv/conf", Target: "/etc/app", ReadOnly: true }],
      },
      "otterdeploy-gitea",
    );
    expect(built.UpdateConfig?.Order).toBe("start-first");
  });
});
