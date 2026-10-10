/**
 * The plain-Docker cutover against an in-memory daemon with a
 * virtual clock: the previous version keeps its name, its aliases and its
 * traffic until the new one has passed the readiness gate, and keeps them for
 * good when the new one never does. One scenario per way a new version can fail to become ready.
 */
import type { CreateContainerOptions } from "@otterdeploy/docker";

import { describe, expect, test } from "vite-plus/test";

import type { Listener, PortProbe } from "../readiness";

import {
  candidateName,
  type ContainerObservation,
  parkedName,
  rollOutContainer,
  type RolloutHost,
  type RolloutInput,
} from "../docker-rollout";
import { readinessPlan, READY_POLL_MS, READY_PROGRESS_EVERY_MS } from "../readiness";

/** What a version does, as a function of how long it has been running. */
interface Behaviour {
  state: (ms: number) => string;
  restarts?: (ms: number) => number;
  exitCode?: number;
  health?: (ms: number) => ContainerObservation["health"];
  /** Sockets it listens on at `ms`. */
  listeners: (ms: number) => Listener[];
  output: string[];
}

const wildcard = (port: number): Listener[] => [{ address: "0.0.0.0", port }];
const always =
  <T>(value: T) =>
  () =>
    value;

const VERSIONS: Record<string, Behaviour> = {
  "app:v1": { state: always("running"), listeners: always(wildcard(3000)), output: ["v1 up"] },
  express: { state: always("running"), listeners: always(wildcard(3000)), output: ["listening"] },
  "port-mismatch": {
    state: always("running"),
    listeners: always(wildcard(3001)),
    output: ["listening on 0.0.0.0:3001"],
  },
  "binds-localhost": {
    state: always("running"),
    listeners: always([{ address: "127.0.0.1", port: 3000 }]),
    output: ["listening on 127.0.0.1:3000 only"],
  },
  "crash-loop": {
    // Serves for 2 s, exits 1, restarted a second later, forever.
    state: (ms) => (ms % 3000 < 2000 ? "running" : "restarting"),
    restarts: (ms) => Math.floor(ms / 3000),
    exitCode: 1,
    listeners: (ms) => (ms % 3000 < 2000 ? wildcard(3000) : []),
    output: ["exiting with code 1 on purpose"],
  },
  "never-healthy": {
    state: always("running"),
    health: (ms) => (ms < 25_000 ? "starting" : "unhealthy"),
    listeners: always(wildcard(3000)),
    output: ["listening on 0.0.0.0:3000; /healthz always 503"],
  },
  "slow-start": {
    state: always("running"),
    health: (ms) => (ms < 95_000 ? "starting" : "healthy"),
    listeners: (ms) => (ms < 90_000 ? [] : wildcard(3000)),
    output: ["still booting"],
  },
};

interface FakeContainer {
  id: string;
  image: string;
  running: boolean;
  startedAt: number;
  aliases: string[];
}

function createFakeHost(initial: Array<{ name: string; image: string; aliases: string[] }>) {
  let clock = 0;
  let ids = 0;
  const containers = new Map<string, FakeContainer>();
  const calls: string[] = [];
  const lines: string[] = [];
  const add = (name: string, image: string, aliases: string[]) => {
    ids += 1;
    containers.set(name, { id: `c${ids}`, image, running: true, startedAt: clock, aliases });
  };
  for (const c of initial) add(c.name, c.image, c.aliases);
  const behaviour = (c: FakeContainer) => VERSIONS[c.image] ?? VERSIONS["app:v1"];
  const listening = (c: FakeContainer) => {
    const b = behaviour(c);
    const ms = clock - c.startedAt;
    return c.running && b && b.state(ms) === "running" ? b.listeners(ms) : [];
  };

  const host: RolloutHost = {
    async observe(name) {
      const c = containers.get(name);
      if (!c) return null;
      const b = behaviour(c);
      const ms = clock - c.startedAt;
      const state = c.running ? (b?.state(ms) ?? "running") : "exited";
      return {
        id: c.id,
        state,
        exitCode: state === "running" ? null : (b?.exitCode ?? 0),
        restartCount: b?.restarts?.(ms) ?? 0,
        oomKilled: false,
        health: b?.health?.(ms) ?? null,
        healthOutput: null,
      };
    },
    async probePort(name, port): Promise<PortProbe> {
      const c = containers.get(name);
      if (!c) return "closed";
      return listening(c).some((l) => l.port === port && l.address !== "127.0.0.1")
        ? "open"
        : "closed";
    },
    async listeners(name) {
      const c = containers.get(name);
      return c ? listening(c) : null;
    },
    async logTail(name, n) {
      const c = containers.get(name);
      return c ? (behaviour(c)?.output ?? []).slice(-n) : [];
    },
    async createAndStart(options: CreateContainerOptions) {
      const name = options.name ?? "";
      calls.push(`create ${name}`);
      if (containers.has(name)) throw new Error(`name ${name} in use`);
      const aliases = Object.values(options.NetworkingConfig?.EndpointsConfig ?? {}).flatMap(
        (e) => e.Aliases ?? [],
      );
      add(name, options.Image ?? "", aliases);
    },
    async remove(name) {
      if (containers.delete(name)) calls.push(`remove ${name}`);
    },
    async stop(name) {
      const c = containers.get(name);
      if (c) c.running = false;
      calls.push(`stop ${name}`);
    },
    async start(name) {
      const c = containers.get(name);
      if (!c) throw new Error(`no ${name}`);
      c.running = true;
      c.startedAt = clock;
      calls.push(`start ${name}`);
    },
    async rename(from, to) {
      const c = containers.get(from);
      if (!c || containers.has(to)) throw new Error(`rename ${from} -> ${to}`);
      containers.delete(from);
      containers.set(to, c);
      calls.push(`rename ${from} ${to}`);
    },
    async setAliases(name, _network, aliases) {
      const c = containers.get(name);
      if (!c) throw new Error(`no ${name}`);
      c.aliases = aliases;
      calls.push(`alias ${name}`);
    },
    log: (line) => lines.push(`${Math.round(clock / 1000)}s ${line}`),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  };
  return { host, containers, calls, lines, elapsed: () => clock };
}

const ALIASES = ["web", "web.acme.internal", "web"];

function rollout(image: string, overrides: Partial<RolloutInput> = {}): RolloutInput {
  const healthchecked = image === "never-healthy" || image === "slow-start";
  return {
    options: {
      name: "web",
      Image: image,
      NetworkingConfig: { EndpointsConfig: { "otterdeploy-acme": { Aliases: ALIASES } } },
    },
    serviceName: "web",
    networkName: "otterdeploy-acme",
    aliases: ALIASES,
    plan: readinessPlan({
      healthcheck: healthchecked
        ? {
            intervalMs: 5000,
            timeoutMs: 3000,
            retries: 3,
            startPeriodMs: image === "slow-start" ? 180_000 : 10_000,
          }
        : null,
      port: 3000,
    }),
    exclusive: null,
    ...overrides,
  };
}

const serving = () => [{ name: "web", image: "app:v1", aliases: ALIASES }];

describe("blue-green cutover", () => {
  test("a ready version takes the aliases, then the old one goes, then it takes the name", async () => {
    const fake = createFakeHost(serving());
    const status = await rollOutContainer(fake.host, rollout("express"));
    expect(status.status).toBe("running");
    expect(fake.calls).toEqual([
      `create ${candidateName("web")}`,
      `alias ${candidateName("web")}`,
      "remove web",
      `rename ${candidateName("web")} web`,
    ]);
    const web = fake.containers.get("web");
    expect(web?.image).toBe("express");
    expect(web?.aliases).toEqual(ALIASES);
    expect(fake.containers.has(candidateName("web"))).toBe(false);
    // Gated with no aliases: nothing could route to it before it was ready.
    expect(fake.elapsed()).toBeGreaterThanOrEqual(10_000);
    expect(fake.elapsed() % READY_POLL_MS).toBe(0);
  });

  test("port-mismatch: fails at the window naming the port it does listen on; v1 untouched", async () => {
    const fake = createFakeHost(serving());
    const status = await rollOutContainer(fake.host, rollout("port-mismatch"));
    expect(status).toMatchObject({ status: "error", rolledBack: true, serviceId: "c1" });
    expect(status.errorMessage).toBe(
      "new version never became ready: nothing accepted a connection on port 3000 within 120s; the app is listening on 0.0.0.0:3001 instead: make it listen on port 3000 (or change the service's port); the previous version keeps serving",
    );
    expect(fake.containers.get("web")).toMatchObject({
      image: "app:v1",
      running: true,
      aliases: ALIASES,
    });
    expect(fake.containers.has(candidateName("web"))).toBe(false);
    expect(fake.calls).not.toContain("remove web");
    // Its own output survives it, in the deployment log.
    expect(fake.lines.some((l) => l.includes("listening on 0.0.0.0:3001"))).toBe(true);
  });

  test("binds-localhost: the reason names the loopback bind", async () => {
    const fake = createFakeHost(serving());
    const status = await rollOutContainer(fake.host, rollout("binds-localhost"));
    expect(status.rolledBack).toBe(true);
    expect(status.errorMessage).toContain("port 3000 is bound to 127.0.0.1 only");
    expect(fake.containers.get("web")?.image).toBe("app:v1");
  });

  test("crash-loop: answering between crashes is not ready; the restarts fail it", async () => {
    const fake = createFakeHost(serving());
    const status = await rollOutContainer(fake.host, rollout("crash-loop"));
    expect(status.errorMessage).toBe(
      "new version kept crashing: exited with code 1 and restarted 3 times before it became ready; the previous version keeps serving",
    );
    expect(fake.containers.get("web")?.image).toBe("app:v1");
    expect(fake.elapsed()).toBeLessThan(15_000);
  });

  test("never-healthy: the first unhealthy report fails it", async () => {
    const fake = createFakeHost(serving());
    const status = await rollOutContainer(fake.host, rollout("never-healthy"));
    expect(status.errorMessage).toBe(
      "new version failed its healthcheck; the previous version keeps serving",
    );
    expect(fake.elapsed()).toBeLessThan(30_000);
    expect(fake.containers.get("web")?.image).toBe("app:v1");
  });

  test("slow-start: the old version serves through a 90 s boot, then the cutover", async () => {
    const fake = createFakeHost(serving());
    const status = await rollOutContainer(fake.host, rollout("slow-start"));
    expect(status.status).toBe("running");
    expect(fake.containers.get("web")?.image).toBe("slow-start");
    expect(fake.elapsed()).toBeGreaterThanOrEqual(105_000);
    // A boot that slow says so while it waits, about every 15 s.
    const progress = fake.lines.filter((l) => l.includes("still waiting"));
    expect(progress.length).toBeGreaterThanOrEqual(Math.floor(95_000 / READY_PROGRESS_EVERY_MS));
    expect(progress[0]).toContain("health starting, port 3000 closed");
  });

  test("a candidate left behind by a deploy that died mid-gate is cleared first", async () => {
    const fake = createFakeHost([
      ...serving(),
      { name: candidateName("web"), image: "crash-loop", aliases: [] },
    ]);
    const status = await rollOutContainer(fake.host, rollout("express"));
    expect(status.status).toBe("running");
    expect(fake.calls[0]).toBe(`remove ${candidateName("web")}`);
  });
});

describe("swap cutover (a host port, or a volume two copies must not share)", () => {
  test("a failed version is removed and the parked one restored under its name", async () => {
    const fake = createFakeHost(serving());
    const status = await rollOutContainer(
      fake.host,
      rollout("port-mismatch", { exclusive: "the service publishes a host port" }),
    );
    expect(status.rolledBack).toBe(true);
    expect(fake.calls).toEqual([
      "stop web",
      `rename web ${parkedName("web")}`,
      "create web",
      "remove web",
      `rename ${parkedName("web")} web`,
      "start web",
    ]);
    expect(fake.containers.get("web")).toMatchObject({ image: "app:v1", running: true });
  });

  test("a ready version replaces the parked one", async () => {
    const fake = createFakeHost(serving());
    const status = await rollOutContainer(
      fake.host,
      rollout("express", { exclusive: "the service publishes a host port" }),
    );
    expect(status.status).toBe("running");
    expect(fake.containers.get("web")?.image).toBe("express");
    expect(fake.containers.has(parkedName("web"))).toBe(false);
  });
});

describe("swap for a service that writes a volume", () => {
  test("the old copy stops before the new one starts, and the log says why", async () => {
    // gitea: two copies on one /data volume, the new one
    // could not take its queue lock and exited, so every redeploy failed.
    const fake = createFakeHost(serving());
    const status = await rollOutContainer(
      fake.host,
      rollout("express", { exclusive: "the service writes to /data (a volume it keeps)" }),
    );
    expect(status.status).toBe("running");
    expect(fake.calls.slice(0, 3)).toEqual([
      "stop web",
      `rename web ${parkedName("web")}`,
      "create web",
    ]);
    expect(
      fake.lines.some((l) =>
        l.includes(
          "the service writes to /data (a volume it keeps): stopping the previous version",
        ),
      ),
    ).toBe(true);
  });
});

describe("fresh rollout (nothing serving yet)", () => {
  test("the first version is gated too, and reported failed without a rollback", async () => {
    const fake = createFakeHost([]);
    const status = await rollOutContainer(fake.host, rollout("never-healthy"));
    expect(status).toMatchObject({ status: "error", rolledBack: false });
    expect(status.errorMessage).toBe("new version failed its healthcheck");
    // Kept for its logs: there is nothing to restore in its place.
    expect(fake.containers.get("web")?.image).toBe("never-healthy");
  });

  test("a ready first version reports running", async () => {
    const fake = createFakeHost([]);
    const status = await rollOutContainer(fake.host, rollout("express"));
    expect(status.status).toBe("running");
    expect(fake.calls).toEqual(["create web"]);
  });
});
