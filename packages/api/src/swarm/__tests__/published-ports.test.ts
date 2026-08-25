/**
 * What reaches the host, and on which port.
 *
 * The incident this pins: omitting `PublishedPort` lets swarm assign one from
 * the ingress range (30000-32767). For TCP that is invisible — the edge dials
 * the container over the overlay by service name (caddy/layer4.ts emits
 * `proxy <serviceName>:<port>`), so the host port is never the address anyone
 * uses. UDP has no such path: Caddy's layer4 proxy is TCP and the HTTP edge
 * obviously is too, so for UDP the published host port IS the address clients
 * dial. A random one meant NetBird's STUN (3478/udp) and LiveKit's media
 * (7882/udp) were bound to something nothing was told about, and therefore
 * unreachable, while the UI reported the port as published.
 */

import { describe, expect, test } from "vite-plus/test";

import type { SwarmServiceSpec } from "../service";

import { buildServiceSpec } from "../internals";

const PROJECT_NET = "otterdeploy-myproject";

const base: SwarmServiceSpec = {
  resourceId: "res_1",
  resourceName: "media",
  projectSlug: "myproject",
  serviceName: "myproject-media",
  internalHostname: "media.myproject.internal",
  image: "livekit/livekit-server:v1.13.5",
  env: {},
  replicas: 1,
  restart: { condition: "on-failure", delayMs: 5000 },
  ports: [],
  mounts: [],
  forceUpdateCounter: 0,
};

const portsOf = (spec: SwarmServiceSpec) =>
  buildServiceSpec(spec, PROJECT_NET).EndpointSpec?.Ports ?? [];

describe("published ports", () => {
  test("a UDP port is pinned to the container port, because that IS its address", () => {
    const ports = portsOf({
      ...base,
      ports: [{ containerPort: 3478, protocol: "udp", appProtocol: "tcp" }],
    });
    expect(ports).toEqual([
      { Protocol: "udp", TargetPort: 3478, PublishedPort: 3478, PublishMode: "ingress" },
    ]);
  });

  test("a raw TCP port keeps swarm's assignment: the edge reaches it over the overlay", () => {
    const ports = portsOf({
      ...base,
      ports: [{ containerPort: 5432, protocol: "tcp", appProtocol: "tcp" }],
    });
    // No PublishedPort key at all — pinning it would newly collide two
    // projects that both run Postgres, for a host port nothing dials.
    expect(ports).toEqual([{ Protocol: "tcp", TargetPort: 5432, PublishMode: "ingress" }]);
  });

  test("HTTP ports are not published to the host at all", () => {
    const ports = portsOf({
      ...base,
      ports: [{ containerPort: 7880, protocol: "tcp", appProtocol: "http" }],
    });
    expect(ports).toEqual([]);
  });

  test("a mixed service publishes only what needs the host, pinning only UDP", () => {
    // LiveKit's real shape: HTTP signalling, TCP fallback, UDP media.
    const ports = portsOf({
      ...base,
      ports: [
        { containerPort: 7880, protocol: "tcp", appProtocol: "http" },
        { containerPort: 7881, protocol: "tcp", appProtocol: "tcp" },
        { containerPort: 7882, protocol: "udp", appProtocol: "tcp" },
      ],
    });
    expect(ports).toEqual([
      { Protocol: "tcp", TargetPort: 7881, PublishMode: "ingress" },
      { Protocol: "udp", TargetPort: 7882, PublishedPort: 7882, PublishMode: "ingress" },
    ]);
  });
});
