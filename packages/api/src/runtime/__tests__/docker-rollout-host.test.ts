/**
 * The real rollout host and the plain-Docker driver against a fake
 * Docker daemon on a unix socket: every Docker call is the shipped code, only
 * the daemon is scripted. Covers the edge-side port probe (and its fallbacks),
 * the cutover steps and their failure paths, and one full `dockerDriver.update`
 * per outcome: a ready version cut over, a crashing one removed while the
 * previous version keeps its name and aliases.
 */
import { Docker } from "@otterdeploy/docker";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { RolloutHost } from "../docker-rollout";

import { type FakeDockerDaemon, startFakeDockerDaemon } from "../../__tests__/fake-docker-daemon";
import { dockerDriver } from "../docker-driver";
import { candidateName } from "../docker-rollout";
import { createDockerRolloutHost } from "../docker-rollout-host";
import { probeEdgePort } from "../edge-probe";
import { STATEFUL_STOP_GRACE_S } from "../stop-policy";

const socketPath = vi.hoisted(() => {
  const path = `/tmp/otterdeploy-rollout-${process.pid}.sock`;
  /* oxlint-disable-next-line node/no-process-env -- test env boundary: the drivers read DOCKER_HOST through Docker.fromEnv */
  process.env.DOCKER_HOST = `unix://${path}`;
  return path;
});

const NETWORK = "otterdeploy-acme";
const PROC_WILDCARD_3000 =
  "  sl  local_address rem_address   st\n   0: 00000000:0BB8 00000000:0000 0A\n";
const PROC_LOCALHOST_3000 =
  "  sl  local_address rem_address   st\n   0: 0100007F:0BB8 00000000:0000 0A\n";

let dockerd: FakeDockerDaemon;
let docker: Docker;
let host: RolloutHost;
const lines: string[] = [];

/** The edge answers `nc -z <host> <port>` with `reachable(host, port)`. */
function addEdge(reachable: (target: string, port: string) => boolean | "usage") {
  return dockerd.addContainer({
    name: "caddy",
    networks: { [NETWORK]: { aliases: [] } },
    exec: (cmd) => {
      const [, , , , target = "", port = ""] = cmd;
      const verdict = reachable(target, port);
      if (verdict === "usage")
        return { exitCode: 1, stderr: "BusyBox nc\nUsage: nc [OPTIONS] HOST PORT" };
      return verdict ? { exitCode: 0 } : { exitCode: 1, stderr: "" };
    },
  });
}

beforeAll(() => {
  dockerd = startFakeDockerDaemon(socketPath);
  docker = Docker.fromEnv();
});

afterAll(() => {
  docker.destroy();
  dockerd.stop();
});

beforeEach(() => {
  dockerd.state.containers = [];
  dockerd.state.failing.clear();
  dockerd.state.seen = [];
  dockerd.state.stops = [];
  dockerd.state.networks = new Set([NETWORK]);
  dockerd.state.onCreate = () => undefined;
  lines.length = 0;
  host = createDockerRolloutHost(docker, {
    networkName: NETWORK,
    extraNetworks: [],
    deployLog: { line: (l) => lines.push(l), close: async () => undefined },
  });
});

describe("observe", () => {
  test("reads state, restarts, health and the last healthcheck output", async () => {
    dockerd.addContainer({
      name: "web",
      status: "restarting",
      exitCode: 1,
      restartCount: 2,
      health: "unhealthy",
      healthLog: ["first", "GET /healthz -> 503"],
    });
    expect(await host.observe("web")).toMatchObject({
      state: "restarting",
      exitCode: 1,
      restartCount: 2,
      health: "unhealthy",
      healthOutput: "GET /healthz -> 503",
    });
    expect(await host.observe("absent")).toBeNull();
  });

  test("a running container reports no exit code (docker's 0 after a restart)", async () => {
    dockerd.addContainer({ name: "web", exitCode: 0, restartCount: 1 });
    expect((await host.observe("web"))?.exitCode).toBeNull();
  });
});

describe("port probe", () => {
  test("from the edge: open and closed are the edge's own connect", async () => {
    addEdge((target, port) => target === "web--next" && port === "3000");
    dockerd.addContainer({ name: "web--next" });
    expect(await host.probePort("web--next", 3000)).toBe("open");
    expect(await host.probePort("web--next", 3001)).toBe("closed");
  });

  test("an edge nc without -z falls back to the app's listening sockets", async () => {
    addEdge(() => "usage");
    dockerd.addContainer({
      name: "local",
      exec: () => ({ exitCode: 0, stdout: PROC_LOCALHOST_3000 }),
    });
    dockerd.addContainer({
      name: "wild",
      exec: () => ({
        exitCode: 1,
        stdout: PROC_WILDCARD_3000,
        stderr: "cat: /proc/net/tcp6: No such file",
      }),
    });
    expect(await host.probePort("local", 3000)).toBe("closed");
    expect(await host.probePort("wild", 3000)).toBe("open");
  });

  test("no edge and no readable sockets: unavailable, never closed", async () => {
    dockerd.addContainer({
      name: "distroless",
      exec: () => ({ exitCode: 127, stderr: "exec: cat: not found" }),
    });
    expect(await host.probePort("distroless", 3000)).toBe("unavailable");
    expect(await host.listeners("distroless")).toBeNull();
    expect(await host.listeners("absent")).toBeNull();
  });

  test("an exec whose exit code cannot be read is unavailable, not open", async () => {
    addEdge(() => true);
    const edge = dockerd.state.containers.find((c) => c.name === "caddy");
    if (edge) edge.exec = () => ({ exitCode: 0, running: true });
    expect(await probeEdgePort(docker, "web", 3000)).toBe("unavailable");
  });

  test("the edge probe bounds its own connect with nc -w", () => {
    addEdge(() => true);
    const edge = dockerd.state.containers.find((c) => c.name === "caddy");
    const seenCmds: string[][] = [];
    if (edge) {
      edge.exec = (cmd) => {
        seenCmds.push(cmd);
        return { exitCode: 0 };
      };
    }
    return probeEdgePort(docker, "web", 3000).then((probe) => {
      expect(probe).toBe("open");
      expect(seenCmds[0]).toEqual(["nc", "-z", "-w", "2", "web", "3000"]);
    });
  });
});

describe("cutover steps", () => {
  test("logTail returns the container's own last lines", async () => {
    dockerd.addContainer({ name: "web--next", logs: ["one", "two", "three"] });
    expect(await host.logTail("web--next", 2)).toEqual(["two", "three"]);
    expect(await host.logTail("absent", 2)).toEqual([]);
  });

  test("setAliases re-attaches under exactly the service's aliases", async () => {
    const c = dockerd.addContainer({ name: "web--next", networks: { [NETWORK]: { aliases: [] } } });
    await host.setAliases("web--next", NETWORK, ["web", "web.internal"]);
    expect(c.networks[NETWORK]?.aliases).toEqual(["web", "web.internal"]);
  });

  test("setAliases surfaces a refused disconnect or connect", async () => {
    dockerd.addContainer({ name: "web--next", networks: { [NETWORK]: { aliases: [] } } });
    dockerd.state.failing.add(`POST /networks/${NETWORK}/connect`);
    await expect(host.setAliases("web--next", NETWORK, ["web"])).rejects.toThrow(
      "injected failure",
    );
    // Now detached: the disconnect itself is refused.
    await expect(host.setAliases("web--next", NETWORK, ["web"])).rejects.toThrow();
  });

  test("rename and start: a missing container and a refusing daemon both fail loudly", async () => {
    await expect(host.rename("absent", "web")).rejects.toThrow("disappeared during the rollout");
    await expect(host.start("absent")).rejects.toThrow("disappeared during the rollout");
    const c = dockerd.addContainer({ name: "web--prev", status: "exited" });
    dockerd.state.failing.add(`POST /containers/${c.id}/rename`);
    dockerd.state.failing.add(`POST /containers/${c.id}/start`);
    await expect(host.rename("web--prev", "web")).rejects.toThrow("injected failure");
    await expect(host.start("web--prev")).rejects.toThrow("injected failure");
    dockerd.state.failing.clear();
    await host.rename("web--prev", "web");
    await host.start("web");
    expect(c).toMatchObject({ name: "web", status: "running" });
  });

  test("a stop waits for the container's own grace, and for the new version's if longer", async () => {
    // A database child stopped with a fixed 10 s was killed mid-checkpoint.
    const graceful = createDockerRolloutHost(docker, {
      networkName: NETWORK,
      extraNetworks: [],
      deployLog: { line: () => undefined, close: async () => undefined },
      stopGraceS: 60,
    });
    dockerd.addContainer({ name: "made-before" });
    dockerd.addContainer({ name: "long-grace", stopTimeout: 300 });
    dockerd.addContainer({ name: "short-grace", stopTimeout: 5 });
    await graceful.stop("made-before");
    await graceful.stop("long-grace");
    await graceful.stop("short-grace");
    await host.stop("made-before");
    expect(dockerd.state.stops).toEqual([
      { name: "made-before", t: 60 },
      { name: "long-grace", t: 300 },
      { name: "short-grace", t: 60 },
      { name: "made-before", t: 10 },
    ]);
  });

  test("remove stops with the same grace before deleting", async () => {
    const graceful = createDockerRolloutHost(docker, {
      networkName: NETWORK,
      extraNetworks: [],
      deployLog: { line: () => undefined, close: async () => undefined },
      stopGraceS: 60,
    });
    dockerd.addContainer({ name: "web--prev", stopTimeout: 120 });
    await graceful.remove("web--prev");
    expect(dockerd.state.stops).toEqual([{ name: "web--prev", t: 120 }]);
    expect(dockerd.state.containers).toHaveLength(0);
  });

  test("stop parks, remove stops gracefully then deletes; both no-op when absent", async () => {
    const c = dockerd.addContainer({ name: "web" });
    await host.stop("web");
    expect(c.status).toBe("exited");
    expect(dockerd.state.seen.filter((s) => s.endsWith("/stop"))).toHaveLength(1);
    await host.remove("web");
    expect(dockerd.state.containers).toHaveLength(0);
    await host.stop("web");
    await host.remove("web");
  });

  test("createAndStart: a refused create or start surfaces", async () => {
    dockerd.state.failing.add("POST /containers/create");
    await expect(host.createAndStart({ name: "web", Image: "x" })).rejects.toThrow(
      "injected failure",
    );
    dockerd.state.failing.clear();
    dockerd.state.onCreate = (c) => dockerd.state.failing.add(`POST /containers/${c.id}/start`);
    await expect(host.createAndStart({ name: "web", Image: "x" })).rejects.toThrow(
      "injected failure",
    );
  });

  test("sleep waits", async () => {
    const before = host.now();
    await host.sleep(20);
    expect(host.now() - before).toBeGreaterThanOrEqual(15);
  });
});

/** A service on the project network the way a previous deploy left it. */
function addServing() {
  return dockerd.addContainer({
    name: "acme-web",
    image: "otterdeploy-local/acme-web:v1",
    networks: { [NETWORK]: { aliases: ["acme-web", "acme-web.internal", "web"] } },
  });
}

const spec = (image: string) => ({
  resourceId: "res_1",
  resourceName: "web",
  projectSlug: "acme",
  serviceName: "acme-web",
  internalHostname: "acme-web.internal",
  image,
  env: {},
  replicas: 1,
  restart: { condition: "on-failure" as const, delayMs: 1000 },
  ports: [
    {
      containerPort: 3000,
      protocol: "tcp" as const,
      appProtocol: "http" as const,
      isPrimary: true,
    },
  ],
  mounts: [],
  forceUpdateCounter: 1,
  deploymentId: null,
});

const dataVolume = {
  Type: "volume" as const,
  Source: "otterdeploy-vol-acme-web-data",
  Target: "/var/lib/postgresql/data",
  ReadOnly: false,
};

describe("dockerDriver.update", () => {
  test("a version that crashes on boot is removed; the previous one keeps name and aliases", async () => {
    const previous = addServing();
    addEdge(() => false);
    dockerd.state.onCreate = (c) => {
      c.startsAs = "exited";
      c.logs = ["exiting with code 1 on purpose"];
    };
    const status = await dockerDriver.update(spec("otterdeploy-local/acme-web:v2"));
    expect(status).toMatchObject({ status: "error", rolledBack: true, serviceId: previous.id });
    expect(status.errorMessage).toBe(
      "new version crashed: exited with code 1 before it became ready; the previous version keeps serving",
    );
    expect(dockerd.state.containers.map((c) => c.name).toSorted()).toEqual(["acme-web", "caddy"]);
    expect(previous.networks[NETWORK]?.aliases).toEqual(["acme-web", "acme-web.internal", "web"]);
  });

  test("a redeploy of a service that keeps a volume stops the old version with time to flush", async () => {
    // The Postgres child of a compose stack: stopped with docker's default 10 s
    // it panicked on restart ("could not locate a valid checkpoint record").
    // Made before the policy existed, the old container carries no StopTimeout.
    addServing();
    addEdge((target, port) => target === "acme-web" && port === "3000");
    const status = await dockerDriver.update({
      ...spec("otterdeploy-local/acme-web:v2"),
      mounts: [dataVolume],
    });
    expect(status.status).toBe("running");
    const stop = dockerd.state.stops.find((s) => s.name === "acme-web");
    expect(stop?.t).toBeGreaterThanOrEqual(STATEFUL_STOP_GRACE_S);
    const web = dockerd.state.containers.find((c) => c.name === "acme-web");
    expect(web?.stopTimeout).toBe(STATEFUL_STOP_GRACE_S);
  }, 30_000);

  test("the compose file's stop_grace_period and stop_signal reach the container", async () => {
    addEdge(() => true);
    await dockerDriver.update({
      ...spec("otterdeploy-local/acme-web:v2"),
      mounts: [dataVolume],
      stopGracePeriodMs: 180_000,
      stopSignal: "SIGINT",
    });
    const web = dockerd.state.containers.find((c) => c.name === "acme-web");
    expect(web).toMatchObject({ stopTimeout: 180, stopSignal: "SIGINT" });
  }, 30_000);

  test("a version the edge reaches for the whole hold takes over", async () => {
    const previous = addServing();
    addEdge((target, port) => target === candidateName("acme-web") && port === "3000");
    const status = await dockerDriver.update(spec("otterdeploy-local/acme-web:v2"));
    expect(status.status).toBe("running");
    const web = dockerd.state.containers.find((c) => c.name === "acme-web");
    expect(web?.image).toBe("otterdeploy-local/acme-web:v2");
    expect(web?.networks[NETWORK]?.aliases).toEqual(["acme-web", "acme-web.internal", "web"]);
    expect(dockerd.state.containers).not.toContain(previous);
  }, 30_000);
});
