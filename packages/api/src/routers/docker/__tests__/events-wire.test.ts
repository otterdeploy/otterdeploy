import type { EventMessage } from "@otterdeploy/docker";

import { describe, expect, test } from "vite-plus/test";

import { normalizeDockerEvent } from "../../../swarm/events/normalize";
import { toWireEvent } from "../events-wire";

/** Run a raw daemon payload through the same path the stream uses:
 *  bus normalization first, then the wire flattening under test. */
function wire(raw: EventMessage) {
  return toWireEvent(normalizeDockerEvent(raw));
}

describe("toWireEvent", () => {
  test("container event carries name, labels, and ms timestamp", () => {
    const event = wire({
      Type: "container",
      Action: "die",
      Actor: {
        ID: "abc123",
        Attributes: { name: "web_app.1", image: "ghcr.io/acme/web:1.2", exitCode: "137" },
      },
      // Small exact nano value: realistic epoch-nanos exceed 2^53 and would
      // trip precision lint; the seconds-fallback test covers real magnitudes.
      timeNano: 123_456_789,
    });
    expect(event).toEqual({
      ts: 123,
      type: "container",
      action: "die",
      actorId: "abc123",
      actorName: "web_app.1",
      attributes: { name: "web_app.1", image: "ghcr.io/acme/web:1.2", exitCode: "137" },
    });
  });

  test("seconds-only timestamp falls back through the normalizer to ms", () => {
    const event = wire({
      Type: "container",
      Action: "start",
      Actor: { ID: "abc", Attributes: {} },
      time: 1_700_000_000,
    });
    expect(event.ts).toBe(1_700_000_000_000);
  });

  test("service event uses the service name", () => {
    const event = wire({
      Type: "service",
      Action: "update",
      Actor: { ID: "svc1", Attributes: { name: "acme_api" } },
      timeNano: 1_000_000_000,
    });
    expect(event.type).toBe("service");
    expect(event.actorId).toBe("svc1");
    expect(event.actorName).toBe("acme_api");
  });

  test("task event names the owning service (tasks have no name attribute)", () => {
    const event = wire({
      Type: "task",
      Action: "update",
      Actor: {
        ID: "task1",
        Attributes: { "com.docker.swarm.service.name": "acme_api", state: "running" },
      },
      timeNano: 1_000_000_000,
    });
    expect(event.type).toBe("task");
    expect(event.actorName).toBe("acme_api");
    expect(event.attributes.state).toBe("running");
  });

  test("network event keeps attributes from the raw actor", () => {
    const event = wire({
      Type: "network",
      Action: "connect",
      Actor: {
        ID: "net1",
        Attributes: { name: "acme-mesh", container: "abc123", type: "overlay" },
      },
      timeNano: 1_000_000_000,
    });
    expect(event.type).toBe("network");
    expect(event.actorName).toBe("acme-mesh");
    expect(event.attributes.container).toBe("abc123");
  });

  test("node event recovers the hostname from raw attributes", () => {
    const event = wire({
      Type: "node",
      Action: "update",
      Actor: { ID: "node1", Attributes: { name: "manager-1" } },
      timeNano: 1_000_000_000,
    });
    expect(event.type).toBe("node");
    expect(event.actorName).toBe("manager-1");
  });

  test("image event (normalizer-unknown) surfaces as type image with the ref", () => {
    const event = wire({
      Type: "image",
      Action: "pull",
      Actor: { ID: "ghcr.io/acme/web:1.2", Attributes: { name: "ghcr.io/acme/web" } },
      timeNano: 1_000_000_000,
    });
    expect(event.type).toBe("image");
    expect(event.action).toBe("pull");
    expect(event.actorId).toBe("ghcr.io/acme/web:1.2");
    expect(event.actorName).toBe("ghcr.io/acme/web");
  });

  test("volume event (normalizer-unknown) surfaces as type volume", () => {
    const event = wire({
      Type: "volume",
      Action: "create",
      Actor: { ID: "acme_pg_data", Attributes: { driver: "local" } },
      timeNano: 1_000_000_000,
    });
    expect(event.type).toBe("volume");
    expect(event.attributes.driver).toBe("local");
    // Volume events don't carry a name attribute: the id IS the name.
    expect(event.actorName).toBeNull();
  });

  test("unrecognized daemon types collapse to unknown without losing fields", () => {
    const event = wire({
      Type: "plugin",
      Action: "enable",
      Actor: { ID: "plug1", Attributes: { name: "loki-driver" } },
      timeNano: 1_000_000_000,
    });
    expect(event.type).toBe("unknown");
    expect(event.action).toBe("enable");
    expect(event.actorName).toBe("loki-driver");
  });

  test("bare payload without actor still maps safely", () => {
    const event = wire({ Type: "image", Action: "prune" });
    expect(event).toEqual({
      ts: 0,
      type: "image",
      action: "prune",
      actorId: "",
      actorName: null,
      attributes: {},
    });
  });
});
