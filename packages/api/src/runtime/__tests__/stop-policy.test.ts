/**
 * How the plain-Docker runtime stops a container: a database
 * child of a compose stack was stopped with docker's 10 s default, killed
 * mid-checkpoint, and panicked on the next start. The grace and signal are
 * decided here, written into the container (StopTimeout / StopSignal), and
 * honoured by every stop.
 */
import { describe, expect, test } from "vite-plus/test";

import type { ContainerSpec } from "../types";

import { buildContainerOptions } from "../docker-driver-helpers";
import {
  DATABASE_STOP_GRACE_S,
  DEFAULT_STOP_GRACE_S,
  serviceStopGraceSeconds,
  STATEFUL_STOP_GRACE_S,
  stopConfig,
} from "../stop-policy";

const base: ContainerSpec = {
  resourceId: "res_1",
  resourceName: "db",
  projectSlug: "n8n",
  serviceName: "n8n-db",
  internalHostname: "db",
  image: "postgres:17",
  env: {},
  replicas: 1,
  restart: { condition: "any", delayMs: 5000 },
  ports: [],
  mounts: [],
  forceUpdateCounter: 0,
};

const volume = {
  Type: "volume" as const,
  Source: "n8n-db-data",
  Target: "/var/lib/postgresql/data",
  ReadOnly: false,
};

describe("serviceStopGraceSeconds", () => {
  test("a stateless service keeps docker's 10 s", () => {
    expect(serviceStopGraceSeconds(base)).toBe(DEFAULT_STOP_GRACE_S);
  });

  test("a service that writes a volume gets time to flush", () => {
    expect(serviceStopGraceSeconds({ ...base, mounts: [volume] })).toBe(STATEFUL_STOP_GRACE_S);
    expect(STATEFUL_STOP_GRACE_S).toBeGreaterThan(DEFAULT_STOP_GRACE_S);
  });

  test("a read-only mount is not state", () => {
    expect(serviceStopGraceSeconds({ ...base, mounts: [{ ...volume, ReadOnly: true }] })).toBe(
      DEFAULT_STOP_GRACE_S,
    );
  });

  test("the compose file's stop_grace_period wins, rounded up to whole seconds", () => {
    expect(serviceStopGraceSeconds({ ...base, mounts: [volume], stopGracePeriodMs: 300_000 })).toBe(
      300,
    );
    expect(serviceStopGraceSeconds({ ...base, stopGracePeriodMs: 1_500 })).toBe(2);
    expect(serviceStopGraceSeconds({ ...base, stopGracePeriodMs: 100 })).toBe(1);
  });

  test("a managed database waits longer than a volume-backed service", () => {
    expect(DATABASE_STOP_GRACE_S).toBeGreaterThan(STATEFUL_STOP_GRACE_S);
  });

  test("no default outlasts the API's own 120 s call timeout", () => {
    // A process that ignores the stop signal waits the whole grace. A restart
    // right after a database was created hit that (the image's entrypoint is a
    // shell script as PID 1 while it runs initdb) and with a 120 s grace the
    // setPlacement call timed out at exactly its 120 s limit.
    expect(DATABASE_STOP_GRACE_S).toBeLessThan(120);
    expect(STATEFUL_STOP_GRACE_S).toBeLessThan(DATABASE_STOP_GRACE_S);
  });
});

describe("the container is created with its stop policy", () => {
  test("buildContainerOptions writes StopTimeout, and StopSignal only when asked for", () => {
    const plain = buildContainerOptions({ ...base, mounts: [volume] }, "net");
    expect(plain.StopTimeout).toBe(STATEFUL_STOP_GRACE_S);
    expect(plain).not.toHaveProperty("StopSignal");
    const custom = buildContainerOptions(
      { ...base, mounts: [volume], stopGracePeriodMs: 90_000, stopSignal: "SIGINT" },
      "net",
    );
    expect(custom).toMatchObject({ StopTimeout: 90, StopSignal: "SIGINT" });
  });

  test("stopConfig is what buildContainerOptions spreads", () => {
    expect(stopConfig({ ...base, stopSignal: "SIGQUIT" })).toEqual({
      StopTimeout: DEFAULT_STOP_GRACE_S,
      StopSignal: "SIGQUIT",
    });
  });
});
