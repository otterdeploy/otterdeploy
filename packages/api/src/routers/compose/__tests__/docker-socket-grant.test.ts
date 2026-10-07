/**
 * A tenant compose stack cannot mount the Docker daemon socket unless an
 * installation administrator grants it to that stack.
 *
 * Access to `/var/run/docker.sock` is equivalent to root on the host, and
 * `:ro` on the bind does not change that. Nothing records which stacks came
 * from a vetted template, so `HOST_BIND_ALLOWLIST` (lib/host-binds.ts) only
 * lists the path; it is never mounted without a per-stack grant.
 *
 * Denied by default on both compose paths (reconcile map and swarm spec), and
 * on the deploy path that builds a spec from STORED mounts, until an install
 * admin explicitly grants it to one stack (`compose.setDockerSocketGrant`,
 * see docker-socket-grant-procedure.test.ts for who may call it). These are
 * the "no grant => denied" half; host-binds.test.ts holds the granted case.
 */
import { hasPrefix, type Id } from "@otterdeploy/shared/id";
import { describe, expect, it } from "vite-plus/test";

import type { StackReconcileContext } from "../reconcile";

import { allowedHostBind, withoutUngrantedHostBinds } from "../../../lib/host-binds";
import { parseCompose } from "../../../stack/compose";
import { composeServiceToSpec } from "../../../stack/compose/to-spec";
import { toServiceFields } from "../reconcile-map";

function service(yaml: string, name: string) {
  const r = parseCompose(yaml);
  if (r.isErr()) throw new Error(r.error.message);
  const svc = r.value.services.find((s) => s.name === name);
  if (!svc) throw new Error(`service ${name} not found`);
  return svc;
}

function testId<P extends string>(value: string, prefix: P): Id<P> {
  if (!hasPrefix(value, prefix)) {
    throw new Error(`test id "${value}" does not carry prefix "${prefix}"`);
  }
  return value;
}

/** A tenant's pasted compose file: nothing about it is a vetted template. */
const TENANT_STACK = `
services:
  shell:
    image: docker:cli
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
`;

const ctx: StackReconcileContext = {
  projectId: testId("project_1", "prj"),
  placementServerId: null,
  organizationId: testId("org_1", "org"),
  exposedSeeds: new Map(),
  stackResourceId: testId("resource_1", "res"),
  projectSlug: "tenant",
  stackName: "shell",
  projectVars: {},
  builtImages: {},
};

describe("the docker socket is not granted to tenant compose stacks", () => {
  it("the host-bind allowlist does not grant /var/run/docker.sock without an install-admin grant", () => {
    expect(allowedHostBind("/var/run/docker.sock")).toBeNull();
    expect(allowedHostBind("/var/run//docker.sock")).toBeNull();
    expect(allowedHostBind("/var/run/./docker.sock")).toBeNull();
  });

  it("the reconcile path drops a tenant stack's /var/run/docker.sock bind", () => {
    const { mounts } = toServiceFields(service(TENANT_STACK, "shell"), ctx, "docker:cli");
    expect(mounts.some((m) => m.source === "/var/run/docker.sock")).toBe(false);
  });

  it("the swarm spec path drops a tenant stack's /var/run/docker.sock bind", () => {
    const spec = composeServiceToSpec(service(TENANT_STACK, "shell"), {
      resourceId: "resource_1",
      projectSlug: "tenant",
      stackName: "shell",
      resolvedEnv: {},
      image: "docker:cli",
      forceUpdateCounter: 0,
    });
    expect(spec.mounts.some((m) => m.Source === "/var/run/docker.sock")).toBe(false);
  });

  it("a stored socket bind is not deployed for an ungranted stack", () => {
    // A stored service_mount row can predate the grant (or survive a revoke);
    // buildSwarmSpec filters them through this at deploy time.
    const stored = [
      { type: "bind", source: "/var/run/docker.sock", target: "/var/run/docker.sock" },
      { type: "volume", source: "shell-data", target: "/data" },
    ];
    expect(withoutUngrantedHostBinds(stored, { dockerSocket: false })).toEqual([stored[1]]);
    expect(withoutUngrantedHostBinds(stored, { dockerSocket: true })).toEqual(stored);
  });

  // `/var/run` is a symlink to `/run` on modern distros, so this spelling
  // reaches the same daemon. It is never listed, so it is always denied.
  it("the /run/docker.sock spelling of the same socket is denied", () => {
    expect(allowedHostBind("/run/docker.sock")).toBeNull();
  });
});
