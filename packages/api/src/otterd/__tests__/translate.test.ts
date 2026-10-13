/**
 * The translator from today's deploy specs to otterd's ServiceSpec: a
 * service and a database deploy the same whichever backend runs them.
 */
import { describe, expect, it } from "vite-plus/test";

import type { ContainerSpec, DatabaseSpec } from "../../runtime/types";

import { databaseToSpec, serviceToSpec } from "../translate";

const service = (over: Partial<ContainerSpec> = {}): ContainerSpec => ({
  resourceId: "res_web",
  resourceName: "web",
  projectSlug: "shop",
  serviceName: "od-shop-web",
  internalHostname: "web",
  networkScopeSuffix: "-staging",
  image: "ghcr.io/acme/web:1.2.3",
  command: ["serve"],
  entrypoint: ["/bin/app"],
  env: { PORT: "8080", DATABASE_URL: "postgres://u:p@db:5432/app" },
  replicas: 2,
  restart: { condition: "on-failure", maxAttempts: 3, delayMs: 2_000 },
  stopGracePeriodMs: 15_000,
  resources: { cpuLimit: 0.5, memoryLimitMb: 256, memoryReservationMb: 128 },
  ports: [{ containerPort: 8080, protocol: "tcp", appProtocol: "http", isPrimary: true }],
  mounts: [],
  forceUpdateCounter: 1,
  deploymentId: "dep_1",
  ...over,
});

describe("serviceToSpec", () => {
  it("carries image, command, env, replicas, restart, limits, ports, aliases and the environment scope", () => {
    const s = serviceToSpec(service(), { nodeId: null }).unwrap();
    expect(s.resourceId).toBe("res_web");
    expect(s.mode).toEqual({ kind: "replicated", replicas: 2 });
    expect(s.task.container).toMatchObject({
      image: { reference: "ghcr.io/acme/web:1.2.3" },
      command: ["/bin/app"],
      args: ["serve"],
      hostname: "web",
      stopGraceMs: 15_000,
      labels: { "otterdeploy.resource.id": "res_web", "otterdeploy.deployment.id": "dep_1" },
    });
    expect(s.task.container.env).toEqual([
      { name: "PORT", value: { kind: "literal", value: "8080" } },
      { name: "DATABASE_URL", value: { kind: "literal", value: "postgres://u:p@db:5432/app" } },
    ]);
    expect(s.task.restart).toMatchObject({
      condition: "on-failure",
      maxAttempts: 3,
      delayMs: 2_000,
    });
    expect(s.task.resources.limits).toEqual({
      nanoCpus: 500_000_000,
      memoryBytes: 256 * 1024 * 1024,
    });
    expect(s.task.resources.reservations.memoryBytes).toBe(128 * 1024 * 1024);
    expect(s.endpoint.ports).toEqual([{ protocol: "tcp", targetPort: 8080, publish: "internal" }]);
    expect(s.endpoint.aliases).toEqual(["od-shop-web", "web"]);
    expect(s.endpoint.scopes).toEqual(["shop-staging"]);
  });

  it("a mount-free service is shared and reschedules; a mounted one is exclusive and stays", () => {
    const free = serviceToSpec(service(), { nodeId: null }).unwrap();
    expect(free.lifecycle).toMatchObject({ exclusive: false, failover: { policy: "reschedule" } });
    const mounted = serviceToSpec(
      service({
        replicas: 1,
        mounts: [
          { Type: "volume", Source: "otterdeploy-vol-web-data", Target: "/data", ReadOnly: false },
        ],
      }),
      { nodeId: null },
    ).unwrap();
    expect(mounted.lifecycle).toMatchObject({ exclusive: true, failover: { policy: "stay" } });
    expect(mounted.update.order).toBe("stop-first");
    expect(mounted.task.mounts).toEqual([
      { kind: "volume", source: "otterdeploy-vol-web-data", target: "/data", readOnly: false },
    ]);
  });

  it("a pinned server is a hard node constraint and stays put", () => {
    const pinned = serviceToSpec(service(), { nodeId: "w1-abc" }).unwrap();
    expect(pinned.task.placement.nodes).toEqual(["w1-abc"]);
    expect(pinned.lifecycle.failover.policy).toBe("stay");
  });

  it("refuses what otterd cannot run safely instead of guessing", () => {
    const shared = serviceToSpec(
      service({ mounts: [{ Type: "volume", Source: "v", Target: "/data", ReadOnly: false }] }),
      { nodeId: null },
    );
    expect(shared.isErr() && shared.error.detail).toContain("SHARED_WRITABLE_MOUNT");
  });
});

describe("databaseToSpec", () => {
  const db: DatabaseSpec = {
    engine: "postgres",
    resourceId: "res_db",
    serviceName: "od-shop-db",
    volumeName: "otterdeploy-pg-shop-db",
    hostnameAlias: "db",
    databaseName: "app",
    username: "app",
    password: "s3cret",
    projectSlug: "shop",
    deploymentId: "dep_2",
    extraEnv: { TZ: "UTC", POSTGRES_PASSWORD: "ignored" },
  };

  it("is one exclusive slot that stays on its volume, with the engine's identity env winning", () => {
    const s = databaseToSpec(db, { nodeId: null }).unwrap();
    expect(s.mode).toEqual({ kind: "replicated", replicas: 1 });
    expect(s.lifecycle).toMatchObject({ exclusive: true, failover: { policy: "stay" } });
    expect(s.task.mounts?.[0]).toMatchObject({ kind: "volume", source: "otterdeploy-pg-shop-db" });
    const env = Object.fromEntries(
      (s.task.container.env ?? []).map((e) => [
        e.name,
        e.value.kind === "literal" ? e.value.value : "",
      ]),
    );
    expect(env.TZ).toBe("UTC");
    expect(env.POSTGRES_PASSWORD).toBe("s3cret");
    expect(s.endpoint.aliases).toEqual(["od-shop-db", "db"]);
    expect(s.update.order).toBe("stop-first");
  });
});
