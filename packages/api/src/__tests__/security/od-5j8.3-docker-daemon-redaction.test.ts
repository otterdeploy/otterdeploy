/**
 * od-5j8.3: Docker daemon inspection surfaces are redacted.
 *
 * Invariant under test: raw Docker Engine API responses (container / image /
 * volume / network inspect, and free-text log tails) carry host secrets.
 * Env vars, bind-mount host paths, command lines, labels, driver options.
 * That must never reach a non-install-admin caller. `safe-view.ts`'s
 * allowlisting functions are the only path a daemon inspect result may take
 * to a router response; every router handler that reaches the daemon must
 * still be gated to the installation principal.
 *
 * This file adds hostile fixtures beyond the existing regression coverage in
 * `routers/docker/__tests__/safe-view.test.ts` (nested/obfuscated secret
 * placement, prototype-pollution-shaped keys, and secrets embedded in
 * fields the allowlist functions don't even have a slot for) and re-asserts
 * the router-level installation gate as a standing regression net.
 */
import type { JsonObject, UnknownRecord } from "@otterdeploy/shared/json";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";

import {
  safeContainerInspect,
  safeImageInspect,
  safeNetworkInspect,
  safeVolumeInspect,
} from "../../routers/docker/safe-view";

const repositoryRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");

function source(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

describe("[od-5j8.3] safe-view allowlists survive hostile / obfuscated placements", () => {
  test("secrets nested under unexpected daemon fields (GraphDriver, ExecIDs, NetworkSettings.Ports) never surface", () => {
    const safe = safeContainerInspect({
      Id: "container_hostile",
      Name: "/svc",
      Config: {
        Image: "app:latest",
        Env: ["OK=1"],
      },
      // Fields safeContainerInspect has no slot for at all. The allowlist
      // approach means these are dropped by construction, not by a denylist
      // that could miss a new one.
      GraphDriver: { Data: { UpperDir: "/secrets/upper", MergedDir: "/secrets/merged" } },
      ExecIDs: ["exec_leaked_shell_history_token_abc123"],
      HostConfig: {
        Binds: ["/root/.ssh:/root/.ssh:ro"],
        PortBindings: { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "leaked-port-secret" }] },
      },
      NetworkSettings: {
        Ports: { "5432/tcp": [{ HostIp: "10.9.9.9", HostPort: "9999" }] },
        SecondaryIPAddresses: [{ Addr: "10.9.9.9" }],
      },
      State: { Status: "running", Running: true },
    });
    const serialized = JSON.stringify(safe);
    for (const forbidden of [
      "/secrets/upper",
      "/secrets/merged",
      "exec_leaked_shell_history_token_abc123",
      "/root/.ssh",
      "leaked-port-secret",
      "10.9.9.9",
      "9999",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("prototype-pollution-shaped daemon payloads do not corrupt the safe view or throw", () => {
    // A hostile/compromised daemon (or MITM'd socket) answering with
    // `__proto__`/`constructor` keys must not pollute the shared Object
    // prototype or crash inspection: it should simply be ignored like any
    // other unexpected field.
    const hostile: unknown = JSON.parse(
      '{"Id":"c1","Name":"/svc","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"Config":{"Image":"app"},"State":{"Status":"running"}}',
    );
    expect(() => safeContainerInspect(hostile)).not.toThrow();
    const safe = safeContainerInspect(hostile);
    expect(safe.id).toBe("c1");
    // A fresh empty object inherits from Object.prototype, so reading the
    // probe key off it walks the exact chain a polluted prototype would
    // poison. UnknownRecord is the honest view for a pollution probe.
    const pollutionProbe: UnknownRecord = {};
    expect(pollutionProbe.polluted).toBeUndefined();
  });

  test("image history / build-arg secrets and volume driver-option secrets never surface even when deeply nested", () => {
    const image = safeImageInspect({
      Id: "sha256:img",
      Config: {
        Env: ["BUILD_SECRET=deep-secret-1"],
        Labels: { "org.deep.secret": "deep-secret-2" },
      },
      History: [
        { CreatedBy: "ARG NPM_TOKEN=deep-secret-3" },
        { CreatedBy: "RUN echo deep-secret-4 > /tmp/x" },
      ],
    });
    const volume = safeVolumeInspect({
      Name: "vol",
      Driver: "local",
      Options: { o: "addr=10.0.0.1,secret=deep-secret-5" },
      Status: { data: { nested: { token: "deep-secret-6" } } },
    });
    const serialized = JSON.stringify({ image, volume });
    for (let i = 1; i <= 6; i++) {
      expect(serialized).not.toContain(`deep-secret-${i}`);
    }
  });

  test("network container membership never leaks peer container names or addresses, even for many peers", () => {
    const containers: JsonObject = {};
    for (let i = 0; i < 5; i++) {
      containers[`container_${i}`] = {
        Name: `tenant-${i}-secret-service`,
        IPv4Address: `10.0.${i}.9/24`,
        MacAddress: `02:42:ac:11:00:0${i}`,
      };
    }
    const network = safeNetworkInspect({
      Id: "net",
      Name: "internal",
      Containers: containers,
    });
    expect(network.attachedContainers).toBe(5);
    const serialized = JSON.stringify(network);
    for (let i = 0; i < 5; i++) {
      expect(serialized).not.toContain(`tenant-${i}-secret-service`);
      expect(serialized).not.toContain(`10.0.${i}.9`);
      expect(serialized).not.toContain(`02:42:ac:11:00:0${i}`);
    }
  });
});

describe("[od-5j8.3] the router-level installation gate is a standing regression net", () => {
  test("every Docker daemon endpoint requires install-admin, never org RBAC", () => {
    const router = source("packages/api/src/routers/docker/index.ts");
    const handlerCount = router.match(/\.handler\(/g)?.length ?? 0;
    const installGateCount = router.match(/requireInstallAdmin\(\)/g)?.length ?? 0;
    expect(handlerCount).toBeGreaterThan(0);
    expect(installGateCount).toBe(handlerCount);
    expect(router).not.toContain("orgScopedProcedure");
    expect(router).not.toContain("requirePermission(");
  });

  test("every host-volume endpoint requires install-admin, never org RBAC", () => {
    const router = source("packages/api/src/routers/volumes/index.ts");
    const handlerCount = router.match(/\.handler\(/g)?.length ?? 0;
    const installGateCount = router.match(/requireInstallAdmin\(\)/g)?.length ?? 0;
    expect(installGateCount).toBe(handlerCount);
    expect(router).not.toContain("orgScopedProcedure");
    expect(router).not.toContain("requirePermission(");
  });

  test("inspect contracts cannot regress to an untyped daemon passthrough", () => {
    expect(source("packages/api/src/routers/docker/contract.ts")).not.toContain(
      ".output(z.unknown())",
    );
    expect(source("packages/api/src/routers/volumes/contract.ts")).not.toContain(
      "z.record(z.string(), z.unknown())",
    );
  });

  test("the daemon-facing service layers import the safe-view allowlist rather than forwarding daemon output verbatim", () => {
    for (const path of [
      "packages/api/src/routers/docker/service-admin.ts",
      "packages/api/src/routers/volumes/service.ts",
    ]) {
      expect(source(path)).toMatch(
        /from ["']\.\/safe-view["']|from ["']\.\.\/docker\/safe-view["']/,
      );
    }
  });
});
