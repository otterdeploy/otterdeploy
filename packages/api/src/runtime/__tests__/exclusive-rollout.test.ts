/**
 * Which services cannot run their new version beside the old one on the
 * plain-Docker runtime (docker-rollout.ts then swaps instead of blue-green).
 *
 * Example: gitea keeps /data on a persistent volume, and a
 * redeploy started the new copy beside the running one. The second copy cannot
 * take its LevelDB queue lock on the shared volume ("unable to lock level db
 * at /data/gitea/queues/common"), exits 0, and the redeploy fails, every time.
 */
import { describe, expect, test } from "vite-plus/test";

import type { ContainerSpec } from "../types";

import { PLATFORM } from "../../constants";
import { exclusiveRollout } from "../exclusive-rollout";

const base: ContainerSpec = {
  resourceId: "res_1",
  resourceName: "web",
  projectSlug: "gitea",
  serviceName: "gitea-web",
  internalHostname: "web.gitea.internal",
  image: "gitea/gitea:latest",
  env: {},
  replicas: 1,
  restart: { condition: "on-failure", delayMs: 5000 },
  ports: [{ containerPort: 3000, protocol: "tcp", appProtocol: "http" }],
  mounts: [],
  forceUpdateCounter: 0,
};

describe("exclusiveRollout", () => {
  test("a stateless HTTP service may run both versions side by side", () => {
    expect(exclusiveRollout(base)).toBeNull();
  });

  test("a service that writes a persistent volume swaps, naming the mount", () => {
    const spec: ContainerSpec = {
      ...base,
      mounts: [
        { Type: "volume", Source: "otterdeploy-vol-gitea-data", Target: "/data", ReadOnly: false },
      ],
    };
    expect(exclusiveRollout(spec)).toBe("the service writes to /data (a volume it keeps)");
  });

  test("a writable bind is shared state too; read-only mounts are not", () => {
    const readOnly: ContainerSpec = {
      ...base,
      mounts: [{ Type: "bind", Source: "/srv/conf", Target: "/etc/app", ReadOnly: true }],
    };
    expect(exclusiveRollout(readOnly)).toBeNull();
    const writable: ContainerSpec = {
      ...readOnly,
      mounts: [{ Type: "bind", Source: "/srv/data", Target: "/var/lib/app", ReadOnly: false }],
    };
    expect(exclusiveRollout(writable)).toBe("the service writes to /var/lib/app (a bind it keeps)");
  });

  test("a config file the platform materialized is not state: the rollout stays zero-gap", () => {
    const spec: ContainerSpec = {
      ...base,
      mounts: [
        {
          Type: "bind",
          Source: `${PLATFORM.files.root}/gitea-web/app.ini`,
          Target: "/etc/app/app.ini",
          ReadOnly: false,
        },
      ],
    };
    expect(exclusiveRollout(spec)).toBeNull();
  });

  test("a published host port still swaps, whatever its mounts", () => {
    const spec: ContainerSpec = {
      ...base,
      ports: [{ containerPort: 22, protocol: "tcp", appProtocol: "tcp" }],
    };
    expect(exclusiveRollout(spec)).toBe("the service publishes a host port");
  });
});
