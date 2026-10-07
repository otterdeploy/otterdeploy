/**
 * A stack's exposure seed names the port its public route fronts, and that
 * port has to reach the child it exposes.
 *
 * Regression: the app service declared no `ports:` (it sits behind the edge;
 * Compose's `expose:` is documentation only), the manifest exposed `app:3000`,
 * and the deploy kept only service → domain from the seed. The child was
 * created with no port, `exposeService` refused it ("has no HTTP port to
 * expose") into the deploy log, and the stack read `running` with no public
 * host.
 */
import type { ComposeExposed } from "@otterdeploy/shared/compose";

import { hasPrefix, type Id } from "@otterdeploy/shared/id";
import { describe, expect, it } from "vite-plus/test";

import type { StackReconcileContext } from "../reconcile";

import { parseCompose } from "../../../stack/compose";
import { toServiceFields } from "../reconcile-map";

function service(yaml: string, name: string) {
  const r = parseCompose(yaml);
  if (r.isErr()) throw new Error(r.error.message);
  const svc = r.value.services.find((s) => s.name === name);
  if (!svc) throw new Error(`service ${name} not found`);
  return svc;
}

/** Brand a test ID through the real prefix guard instead of casting. */
function testId<P extends string>(value: string, prefix: P): Id<P> {
  if (!hasPrefix(value, prefix)) throw new Error(`test id "${value}" lacks "${prefix}"`);
  return value;
}

function context(exposed: ComposeExposed[]): StackReconcileContext {
  return {
    projectId: testId("prj_1", "prj"),
    placementServerId: null,
    organizationId: testId("org_1", "org"),
    exposedSeeds: new Map(exposed.map((e) => [e.service, e])),
    stackResourceId: testId("res_1", "res"),
    projectSlug: "fx",
    stackName: "stack",
    projectVars: {},
    builtImages: {},
  };
}

const NO_PORTS = `
services:
  app:
    image: node:22
  cache:
    image: redis:8
`;

const PUBLISHED = `
services:
  app:
    image: node:22
    ports:
      - "9090:9090"
      - "3000:3000"
      - "5353:5353/udp"
`;

describe("toServiceFields: the exposure seed's port", () => {
  it("declares the exposed port as the primary HTTP port when the file publishes none", () => {
    const ctx = context([{ service: "app", port: 3000, domain: "" }]);
    expect(toServiceFields(service(NO_PORTS, "app"), ctx, "app:1").ports).toEqual([
      { containerPort: 3000, protocol: "tcp", appProtocol: "http", isPrimary: true },
    ]);
  });

  it("leaves a sibling the seed does not name without ports", () => {
    const ctx = context([{ service: "app", port: 3000, domain: "" }]);
    expect(toServiceFields(service(NO_PORTS, "cache"), ctx, "redis:8").ports).toEqual([]);
  });

  it("makes the exposed port primary when the file publishes it among others", () => {
    const ctx = context([{ service: "app", port: 3000, domain: "app.example.com" }]);
    expect(toServiceFields(service(PUBLISHED, "app"), ctx, "app:1").ports).toEqual([
      { containerPort: 9090, protocol: "tcp", appProtocol: "http", isPrimary: false },
      { containerPort: 3000, protocol: "tcp", appProtocol: "http", isPrimary: true },
      { containerPort: 5353, protocol: "udp", appProtocol: "tcp", isPrimary: false },
    ]);
  });

  it("does not turn a udp port into an HTTP route target", () => {
    const ctx = context([{ service: "app", port: 5353, domain: "" }]);
    expect(toServiceFields(service(PUBLISHED, "app"), ctx, "app:1").ports).toEqual([
      { containerPort: 9090, protocol: "tcp", appProtocol: "http", isPrimary: true },
      { containerPort: 3000, protocol: "tcp", appProtocol: "http", isPrimary: false },
      { containerPort: 5353, protocol: "udp", appProtocol: "tcp", isPrimary: false },
    ]);
  });

  it("keeps the file's own primary when nothing is seeded", () => {
    expect(toServiceFields(service(PUBLISHED, "app"), context([]), "app:1").ports[0]).toEqual({
      containerPort: 9090,
      protocol: "tcp",
      appProtocol: "http",
      isPrimary: true,
    });
  });
});
