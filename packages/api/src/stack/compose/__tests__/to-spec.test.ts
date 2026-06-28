import { describe, expect, it } from "vitest";

import { parseCompose } from "../parse";
import { composeServiceToSpec, durationMs } from "../to-spec";

function service(yaml: string, name: string) {
  const r = parseCompose(yaml);
  if (r.isErr()) throw new Error(r.error.message);
  const svc = r.value.services.find((s) => s.name === name);
  if (!svc) throw new Error(`service ${name} not found`);
  return svc;
}

const ctx = {
  resourceId: "resource_1",
  projectSlug: "My Proj",
  stackName: "myproj-stack",
  resolvedEnv: { FOO: "bar" },
  image: "postgres:16",
  deploymentId: "dep_1",
  forceUpdateCounter: 2,
};

describe("composeServiceToSpec", () => {
  it("maps a service onto a SwarmServiceSpec", () => {
    const svc = service(
      `
services:
  postgres:
    image: postgres:16
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "pg_isready"]
      interval: 10s
      retries: 5
    deploy:
      replicas: 1
      resources:
        limits: { cpus: "0.5", memory: 512M }
`,
      "postgres",
    );
    const spec = composeServiceToSpec(svc, ctx);

    expect(spec.serviceName).toBe("myproj-stack-postgres");
    expect(spec.internalHostname).toBe("postgres"); // bare name for DNS
    expect(spec.projectSlug).toBe("my-proj"); // sanitized
    expect(spec.image).toBe("postgres:16");
    expect(spec.env).toEqual({ FOO: "bar" });
    expect(spec.restart).toEqual({
      condition: "any",
      maxAttempts: null,
      delayMs: 5_000,
    });
    // CMD directive stripped — buildServiceSpec re-prepends "CMD".
    expect(spec.healthcheck).toEqual({
      cmd: ["pg_isready"],
      intervalMs: 10_000,
      timeoutMs: 5_000,
      retries: 5,
      startPeriodMs: 0,
    });
    expect(spec.resources).toEqual({
      cpuLimit: 0.5,
      memoryLimitMb: 512,
      cpuReservation: null,
      memoryReservationMb: null,
    });
    expect(spec.ports).toEqual([{ containerPort: 5432, protocol: "tcp", appProtocol: "http" }]);
    expect(spec.mounts).toEqual([
      {
        Type: "volume",
        Source: "myproj-stack-pgdata", // stack-namespaced
        Target: "/var/lib/postgresql/data",
        ReadOnly: false,
      },
    ]);
    expect(spec.deploymentId).toBe("dep_1");
    expect(spec.forceUpdateCounter).toBe(2);
  });

  it("names anonymous volumes deterministically", () => {
    const svc = service(
      `
services:
  cache:
    image: redis
    volumes: ["/data"]
`,
      "cache",
    );
    const spec = composeServiceToSpec(svc, { ...ctx, image: "redis" });
    expect(spec.mounts).toEqual([
      {
        Type: "volume",
        Source: "myproj-stack-cache-data",
        Target: "/data",
        ReadOnly: false,
      },
    ]);
  });

  it("converts a string (shell) healthcheck to /bin/sh -c", () => {
    const svc = service(
      `
services:
  web:
    image: nginx
    healthcheck:
      test: curl -f http://localhost/health
`,
      "web",
    );
    const spec = composeServiceToSpec(svc, { ...ctx, image: "nginx" });
    expect(spec.healthcheck?.cmd).toEqual(["/bin/sh", "-c", "curl -f http://localhost/health"]);
  });

  it("parses compose durations", () => {
    expect(durationMs("30s")).toBe(30_000);
    expect(durationMs("5ms")).toBe(5);
    expect(durationMs("2m")).toBe(120_000);
    expect(durationMs("1h")).toBe(3_600_000);
    expect(durationMs("10")).toBe(10_000); // bare = seconds
    expect(durationMs(undefined)).toBeUndefined();
  });
});
