/**
 * The host-bind allowlist, across both compose paths.
 *
 * Regression: the shipped Dozzle template declares
 * `/var/run/docker.sock:/var/run/docker.sock:ro`, but every catalog template is
 * a SINGLE-FILE stack, so it has no materialized tree and `toMounts` dropped
 * the bind on the `!ctx.stackDir` guard before ever looking at the path. The
 * stack applied clean and the container crash-looped on "Could not connect to
 * any Docker Engine": an error that points at the image, not at us.
 */
import { hasPrefix, type Id } from "@otterdeploy/shared/id";
import { describe, expect, it } from "vite-plus/test";

import type { StackReconcileContext } from "../reconcile";

import { allowedHostBind } from "../../../lib/host-binds";
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

const DOZZLE = `
services:
  dozzle:
    image: amir20/dozzle:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
`;

/** Brand a fixture ID through the real prefix guard instead of casting.
 *  Legacy spellings ("project_", "resource_") are still valid IDs. */
function fixtureId<P extends string>(value: string, prefix: P): Id<P> {
  if (!hasPrefix(value, prefix)) {
    throw new Error(`fixture id "${value}" does not carry prefix "${prefix}"`);
  }
  return value;
}

/** A single-file stack, no materialized tree, so no stackDir. */
const ctx: StackReconcileContext = {
  projectId: fixtureId("project_1", "prj"),
  placementServerId: null,
  organizationId: fixtureId("org_1", "org"),
  exposedSeeds: new Map<string, string>(),
  stackResourceId: fixtureId("resource_1", "res"),
  projectSlug: "store",
  stackName: "dozzle",
  projectVars: {},
  builtImages: {},
};

describe("allowedHostBind", () => {
  it("grants the docker socket read-only", () => {
    expect(allowedHostBind("/var/run/docker.sock")).toEqual({
      source: "/var/run/docker.sock",
      readOnly: true,
    });
  });

  it("normalizes before matching so spelling can't slip past", () => {
    expect(allowedHostBind("/var/run//docker.sock")?.source).toBe("/var/run/docker.sock");
    expect(allowedHostBind("/var/run/./docker.sock")?.source).toBe("/var/run/docker.sock");
  });

  it("denies everything else", () => {
    for (const path of ["/", "/etc/shadow", "/root/.ssh", "/var/run", "/var/run/docker.sock.bak"]) {
      expect(allowedHostBind(path)).toBeNull();
    }
  });

  it("denies traversal that resolves outside a listed path", () => {
    expect(allowedHostBind("/var/run/docker.sock/../../../etc/shadow")).toBeNull();
  });

  it("never treats a relative source as a host bind", () => {
    expect(allowedHostBind("./docker.sock")).toBeNull();
    expect(allowedHostBind("data")).toBeNull();
  });
});

describe("reconcile-map: single-file stack", () => {
  it("mounts the socket even with no stackDir", () => {
    const { mounts } = toServiceFields(service(DOZZLE, "dozzle"), ctx, "amir20/dozzle:latest");
    expect(mounts).toEqual([
      {
        type: "bind",
        target: "/var/run/docker.sock",
        source: "/var/run/docker.sock",
        content: null,
        readOnly: true,
      },
    ]);
  });

  it("still drops a host path that is not listed", () => {
    const svc = service(
      `
services:
  app:
    image: nginx
    volumes: ["/etc/shadow:/etc/shadow:ro"]
`,
      "app",
    );
    expect(toServiceFields(svc, ctx, "nginx").mounts).toEqual([]);
  });

  it("forces read-only when the file asks for write", () => {
    const svc = service(
      `
services:
  app:
    image: nginx
    volumes: ["/var/run/docker.sock:/var/run/docker.sock"]
`,
      "app",
    );
    expect(toServiceFields(svc, ctx, "nginx").mounts[0]?.readOnly).toBe(true);
  });
});

describe("to-spec: the two compose paths agree", () => {
  it("emits the same grant", () => {
    const spec = composeServiceToSpec(service(DOZZLE, "dozzle"), {
      resourceId: "resource_1",
      projectSlug: "store",
      stackName: "dozzle",
      resolvedEnv: {},
      image: "amir20/dozzle:latest",
      forceUpdateCounter: 0,
    });
    expect(spec.mounts).toEqual([
      {
        Type: "bind",
        Source: "/var/run/docker.sock",
        Target: "/var/run/docker.sock",
        ReadOnly: true,
      },
    ]);
  });

  it("drops an unlisted host path", () => {
    const svc = service(
      `
services:
  app:
    image: nginx
    volumes: ["/root/.ssh:/keys:ro"]
`,
      "app",
    );
    const spec = composeServiceToSpec(svc, {
      resourceId: "resource_1",
      projectSlug: "store",
      stackName: "s",
      resolvedEnv: {},
      image: "nginx",
      forceUpdateCounter: 0,
    });
    expect(spec.mounts).toEqual([]);
  });
});

describe("parse warnings", () => {
  it("says so when a host path will not be mounted", () => {
    const r = parseCompose(`
services:
  app:
    image: nginx
    volumes: ["/etc/shadow:/etc/shadow:ro"]
`);
    if (r.isErr()) throw new Error(r.error.message);
    expect(r.value.warnings.join("\n")).toContain('host path "/etc/shadow" is not mounted');
    // The warning names what IS permitted, so the reader knows the rule.
    expect(r.value.warnings.join("\n")).toContain("/var/run/docker.sock");
  });

  it("stays quiet for an allowlisted path", () => {
    const r = parseCompose(DOZZLE);
    if (r.isErr()) throw new Error(r.error.message);
    expect(r.value.warnings).toEqual([]);
  });

  it("stays quiet for named volumes and relative binds", () => {
    const r = parseCompose(`
services:
  app:
    image: nginx
    volumes:
      - data:/var/lib/data
      - ./conf:/etc/conf:ro
`);
    if (r.isErr()) throw new Error(r.error.message);
    expect(r.value.warnings).toEqual([]);
  });
});
