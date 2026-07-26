/**
 * od-5j8.23 — workload security profiles, quotas and admission policy.
 *
 * Invariant under test: EVERY ContainerSpec the platform builds for a
 * tenant workload — the generic swarm service driver (`swarm/internals.ts`,
 * which both image/git services AND every compose sub-service funnel
 * through via `routers/service/spec.ts#buildSwarmSpec`) and the managed
 * database driver (`swarm/database-internals.ts`) — carries the safe
 * baseline by default: capabilities dropped to a curated minimum,
 * `NoNewPrivileges`, a default seccomp profile, a PID ceiling, and a
 * writable-by-default rootfs (so it doesn't break existing images).
 * `Privileged` must never appear anywhere in the rendered spec, regardless
 * of what a caller passes in — there is no field for it anywhere in this
 * pipeline (Docker Swarm's ContainerSpec has no such concept at all).
 */
import { describe, expect, test } from "vite-plus/test";

import type { ProvisionSwarmDatabaseInput } from "../../swarm/database";
import type { SwarmServiceSpec } from "../../swarm/service";

import {
  DEFAULT_CAP_ADD,
  DEFAULT_CAP_DROP,
  DEFAULT_PIDS_LIMIT,
} from "../../swarm/container-security";
import { buildDatabaseSpec } from "../../swarm/database-internals";
import { buildServiceSpec } from "../../swarm/internals";

function baseServiceSpec(overrides: Partial<SwarmServiceSpec> = {}): SwarmServiceSpec {
  return {
    resourceId: "resource_1",
    resourceName: "web",
    projectSlug: "proj",
    serviceName: "od-proj-web",
    internalHostname: "web",
    image: "nginx:latest",
    env: {},
    replicas: 1,
    restart: { condition: "any", maxAttempts: 5, delayMs: 5000 },
    ports: [],
    mounts: [],
    forceUpdateCounter: 1,
    ...overrides,
  };
}

function baseDatabaseInput(
  overrides: Partial<ProvisionSwarmDatabaseInput> = {},
): ProvisionSwarmDatabaseInput {
  return {
    engine: "postgres",
    resourceId: "resource_1",
    serviceName: "od-proj-db",
    volumeName: "od-proj-db-data",
    hostnameAlias: "db",
    databaseName: "app",
    username: "app",
    password: "hunter2hunter2",
    projectSlug: "proj",
    deploymentId: "dep_1",
    ...overrides,
  };
}

function containerSpecOf(spec: SwarmServiceSpec): Record<string, unknown> {
  const rendered = buildServiceSpec(spec, "od-proj-net");
  const taskTemplate = rendered.TaskTemplate as Record<string, unknown>;
  return taskTemplate.ContainerSpec as Record<string, unknown>;
}

function taskTemplateOf(spec: SwarmServiceSpec): Record<string, unknown> {
  const rendered = buildServiceSpec(spec, "od-proj-net");
  return rendered.TaskTemplate as Record<string, unknown>;
}

describe("[od-5j8.23] buildServiceSpec — tenant service default hardening", () => {
  test("drops capabilities to the safe baseline by default", () => {
    const cs = containerSpecOf(baseServiceSpec());
    expect(cs.CapabilityDrop).toEqual(DEFAULT_CAP_DROP);
    expect(cs.CapabilityAdd).toEqual(DEFAULT_CAP_ADD);
    // NET_RAW is the one Docker-default capability the platform withholds.
    expect(DEFAULT_CAP_ADD).not.toContain("NET_RAW");
  });

  test("sets NoNewPrivileges and a default seccomp profile", () => {
    const cs = containerSpecOf(baseServiceSpec());
    const privileges = cs.Privileges as Record<string, unknown>;
    expect(privileges.NoNewPrivileges).toBe(true);
    expect(privileges.Seccomp).toEqual({ Mode: "default" });
  });

  test("rootfs is writable by default (must not break existing images)", () => {
    const cs = containerSpecOf(baseServiceSpec());
    expect(cs.ReadOnly).toBe(false);
  });

  test("never sets a Privileged field, structurally — no field, no key, regardless of input", () => {
    const hostileSpec = baseServiceSpec();
    // Simulate a hostile/mistaken caller trying to smuggle privileged mode
    // in via any channel this function reads. There is no `privileged`
    // field on `SwarmServiceSpec` or `SwarmServiceSecurity` at all — the
    // cast below is the only way to even attempt it, proving the type
    // system already forecloses it for any well-typed caller.
    const withSmuggledField = {
      ...hostileSpec,
      privileged: true,
      security: { ...hostileSpec.security, privileged: true },
    } as unknown as SwarmServiceSpec;
    const cs = containerSpecOf(withSmuggledField);
    expect("Privileged" in cs).toBe(false);
    expect(cs.Privileged).toBeUndefined();
  });

  test("applies a default PID ceiling even when no resources are configured", () => {
    const tt = taskTemplateOf(baseServiceSpec());
    const resources = tt.Resources as Record<string, unknown>;
    const limits = resources.Limits as Record<string, unknown>;
    expect(limits.Pids).toBe(DEFAULT_PIDS_LIMIT);
  });

  test("PID ceiling coexists with explicit CPU/memory limits", () => {
    const tt = taskTemplateOf(
      baseServiceSpec({ resources: { cpuLimit: 1, memoryLimitMb: 512 } }),
    );
    const resources = tt.Resources as Record<string, unknown>;
    const limits = resources.Limits as Record<string, unknown>;
    expect(limits.Pids).toBe(DEFAULT_PIDS_LIMIT);
    expect(limits.NanoCPUs).toBe(1_000_000_000);
    expect(limits.MemoryBytes).toBe(512 * 1024 * 1024);
  });

  test("a service can explicitly disable the PID ceiling (auditable escape hatch, not silent)", () => {
    const tt = taskTemplateOf(baseServiceSpec({ security: { pidsLimit: null } }));
    const resources = tt.Resources as Record<string, unknown> | undefined;
    const limits = resources?.Limits as Record<string, unknown> | undefined;
    expect(limits?.Pids).toBeUndefined();
  });

  test("a service can set a custom PID ceiling", () => {
    const tt = taskTemplateOf(baseServiceSpec({ security: { pidsLimit: 8192 } }));
    const resources = tt.Resources as Record<string, unknown>;
    const limits = resources.Limits as Record<string, unknown>;
    expect(limits.Pids).toBe(8192);
  });

  test("explicit security overrides are honored (auditable per-service escalation, not tenant-controlled)", () => {
    const cs = containerSpecOf(
      baseServiceSpec({
        security: {
          capDrop: ["ALL"],
          capAdd: ["ALL", ...DEFAULT_CAP_ADD], // pretend admin-authorized escalation
          noNewPrivileges: false,
          readOnlyRootfs: true,
        },
      }),
    );
    expect(cs.CapabilityAdd).toContain("ALL");
    const privileges = cs.Privileges as Record<string, unknown>;
    expect(privileges.NoNewPrivileges).toBe(false);
    expect(cs.ReadOnly).toBe(true);
  });
});

describe("[od-5j8.23] buildDatabaseSpec — managed database default hardening", () => {
  test("drops capabilities to the same safe baseline as tenant services", () => {
    const rendered = buildDatabaseSpec(baseDatabaseInput(), "od-proj-net");
    const taskTemplate = rendered.TaskTemplate as Record<string, unknown>;
    const cs = taskTemplate.ContainerSpec as Record<string, unknown>;
    expect(cs.CapabilityDrop).toEqual(DEFAULT_CAP_DROP);
    expect(cs.CapabilityAdd).toEqual(DEFAULT_CAP_ADD);
  });

  test("preserves CHOWN/SETUID/SETGID/DAC_OVERRIDE — the official postgres/mysql entrypoint chown-then-gosu pattern must keep working", () => {
    for (const requiredForEntrypoint of ["CHOWN", "SETUID", "SETGID", "DAC_OVERRIDE"]) {
      expect(DEFAULT_CAP_ADD).toContain(requiredForEntrypoint);
    }
  });

  test("sets NoNewPrivileges + default seccomp, never Privileged", () => {
    const rendered = buildDatabaseSpec(baseDatabaseInput(), "od-proj-net");
    const taskTemplate = rendered.TaskTemplate as Record<string, unknown>;
    const cs = taskTemplate.ContainerSpec as Record<string, unknown>;
    const privileges = cs.Privileges as Record<string, unknown>;
    expect(privileges.NoNewPrivileges).toBe(true);
    expect(privileges.Seccomp).toEqual({ Mode: "default" });
    expect("Privileged" in cs).toBe(false);
  });

  test("applies the default PID ceiling", () => {
    const rendered = buildDatabaseSpec(baseDatabaseInput(), "od-proj-net");
    const taskTemplate = rendered.TaskTemplate as Record<string, unknown>;
    const resources = taskTemplate.Resources as Record<string, unknown>;
    const limits = resources.Limits as Record<string, unknown>;
    expect(limits.Pids).toBe(DEFAULT_PIDS_LIMIT);
  });

  test("is never host-published (pre-existing behavior — port exposure policy)", () => {
    const rendered = buildDatabaseSpec(baseDatabaseInput(), "od-proj-net");
    const endpointSpec = rendered.EndpointSpec as { Ports: unknown[] };
    expect(endpointSpec.Ports).toEqual([]);
  });
});

describe("[od-5j8.23] port exposure — already policy-gated (no change needed)", () => {
  test("only raw-tcp app-protocol ports are swarm-ingress-published; http ports are proxied internally, never raw-published", () => {
    const rendered = buildServiceSpec(
      baseServiceSpec({
        ports: [
          { containerPort: 3000, protocol: "tcp", appProtocol: "http" },
          { containerPort: 5555, protocol: "tcp", appProtocol: "tcp" },
        ],
      }),
      "od-proj-net",
    ) as { EndpointSpec?: { Ports: Array<{ TargetPort: number }> } };
    const published = rendered.EndpointSpec?.Ports.map((p) => p.TargetPort) ?? [];
    expect(published).toEqual([5555]);
    expect(published).not.toContain(3000);
  });
});
