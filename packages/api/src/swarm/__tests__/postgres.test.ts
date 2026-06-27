import { describe, expect, test } from "bun:test";

import type { SwarmPostgresRuntime } from "../postgres";

describe("SwarmPostgresRuntime", () => {
  test("runtime type has expected shape", () => {
    const runtime: SwarmPostgresRuntime = {
      serviceId: "svc_abc123",
      serviceName: "otterdeploy-pg-acme-primary",
      volumeName: "otterdeploy-pgdata-acme-primary",
      networkName: "otterdeploy-resources",
      status: "running",
      health: "healthy",
    };

    expect(runtime.serviceId).toBe("svc_abc123");
    expect(runtime.status).toBe("running");
    expect(runtime.health).toBe("healthy");
  });

  test("missing runtime has null serviceId", () => {
    const runtime: SwarmPostgresRuntime = {
      serviceId: null,
      serviceName: "otterdeploy-pg-acme-primary",
      volumeName: "otterdeploy-pgdata-acme-primary",
      networkName: "otterdeploy-resources",
      status: "missing",
      health: null,
    };

    expect(runtime.serviceId).toBeNull();
    expect(runtime.status).toBe("missing");
  });

  test("runtime status values cover all states", () => {
    const validStatuses: SwarmPostgresRuntime["status"][] = [
      "running",
      "starting",
      "stopped",
      "missing",
      "error",
    ];
    const validHealth: SwarmPostgresRuntime["health"][] = [
      "healthy",
      "unhealthy",
      "starting",
      null,
    ];

    for (const status of validStatuses) {
      expect(typeof status).toBe("string");
    }
    for (const health of validHealth) {
      expect(health === null || typeof health === "string").toBe(true);
    }
  });
});
