/**
 * Domains added to an EXISTING service's manifest must reach it: they were a
 * create-time seed only, so an apply that added one reported nothing to do
 * and created no route. The diff is additive: a live domain the manifest does
 * not name stays, since domains are also managed in the domains UI.
 */
import { describe, expect, it } from "vite-plus/test";

import type { CurrentService, CurrentState } from "../diff";

import { diffManifest } from "../diff";
import { manifestSchema } from "../schema";

function current(domains: string[] | undefined): CurrentState {
  const web: CurrentService = {
    name: "web",
    source: "image",
    image: "nginx:alpine",
    sourceSubdir: null,
    repo: null,
    branch: null,
    imageRepository: null,
    replicas: 1,
    command: null,
    entrypoint: null,
    ports: [{ containerPort: 80, protocol: "tcp", appProtocol: "http", isPrimary: true }],
    env: {},
    publicEnabled: true,
    previewsEnabled: false,
    preDeploy: null,
    postDeploy: null,
    buildConfig: null,
    restartCondition: "on-failure",
    restartMaxAttempts: null,
    restartDelayMs: 5000,
    restartWindowMs: null,
    cpuLimit: null,
    memoryLimitMb: null,
    cpuReservation: null,
    memoryReservationMb: null,
    diskLimitMb: null,
    swapLimitMb: null,
    pidsLimit: null,
    ...(domains === undefined ? {} : { domains }),
  };
  return { services: { web }, databases: {}, composes: {} };
}

const desired = (domains: string[]) =>
  manifestSchema.parse({
    project: "acme-domains",
    services: {
      web: {
        source: "image",
        image: "nginx:alpine",
        ports: [{ container: 80, appProtocol: "http", primary: true }],
        domains: domains.map((domain) => ({ domain })),
      },
    },
  });

describe("service domains diff", () => {
  it("a domain added to an existing service is an update naming only what is new", () => {
    expect(
      diffManifest(desired(["a.example.com", "B.example.com"]), current(["a.example.com"])),
    ).toEqual([
      {
        kind: "update",
        resource: "service",
        name: "web",
        details: {
          fields: { domains: { from: ["a.example.com"], to: ["a.example.com", "b.example.com"] } },
        },
      },
    ]);
  });

  it("is a no-op when every declared domain is live, and never removes one it does not name", () => {
    expect(
      diffManifest(desired(["a.example.com"]), current(["a.example.com", "ui.example.com"])),
    ).toEqual([{ kind: "no-op", resource: "service", name: "web" }]);
  });

  it("stages nothing when the live domains were not loaded", () => {
    expect(diffManifest(desired(["a.example.com"]), current(undefined))[0]?.kind).toBe("no-op");
  });
});
