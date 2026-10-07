/**
 * The swarm side of the health-gated cutover: a rolling update is
 * over when swarm says so (`UpdateStatus`), not when some task, usually the OLD
 * one mid start-first, reads `running`. Driven against a fake daemon on a unix
 * socket; every Docker call is the shipped code.
 */
import { Docker } from "@otterdeploy/docker";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { SwarmServiceSpec } from "../service";

import {
  type FakeService,
  type FakeDockerDaemon,
  startFakeDockerDaemon,
} from "../../__tests__/fake-docker-daemon";
import { settleSwarmUpdate } from "../update-settle";
import {
  awaitSwarmPort,
  awaitSwarmUpdate,
  rollBackSwarmService,
  swarmUpdateOutcome,
} from "../update-watch";

const socketPath = vi.hoisted(() => {
  const path = `/tmp/otterdeploy-swarm-watch-${process.pid}.sock`;
  /* oxlint-disable-next-line node/no-process-env -- test env boundary: the swarm driver reads DOCKER_HOST through Docker.fromEnv */
  process.env.DOCKER_HOST = `unix://${path}`;
  return path;
});

let dockerd: FakeDockerDaemon;
let docker: Docker;

function addService(overrides: Partial<FakeService> = {}): FakeService {
  const svc: FakeService = {
    id: "svc1",
    name: "acme-web",
    version: 10,
    updateState: null,
    updateMessage: null,
    afterUpdate: [],
    afterRollback: ["rollback_started", "rollback_completed"],
    tasks: [{ state: "running", createdAt: "2026-10-07T10:00:00Z" }],
    updates: [],
    ...overrides,
  };
  dockerd.state.services.push(svc);
  return svc;
}

function addEdge(open: boolean) {
  dockerd.addContainer({
    name: "caddy",
    exec: () => (open ? { exitCode: 0 } : { exitCode: 1 }),
  });
}

const spec = (healthcheck: boolean): SwarmServiceSpec => ({
  resourceId: "res_1",
  resourceName: "web",
  projectSlug: "acme",
  serviceName: "acme-web",
  internalHostname: "acme-web.internal",
  image: "registry.example/acme-web:v2",
  env: {},
  replicas: 1,
  restart: { condition: "on-failure", delayMs: 1000 },
  healthcheck: healthcheck
    ? { cmd: ["true"], intervalMs: 1000, timeoutMs: 1000, retries: 1, startPeriodMs: 0 }
    : null,
  ports: [{ containerPort: 3000, protocol: "tcp", appProtocol: "http", isPrimary: true }],
  mounts: [],
  forceUpdateCounter: 2,
});

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
  dockerd.state.services = [];
});

describe("swarmUpdateOutcome", () => {
  test("maps every UpdateStatus swarm reports", () => {
    expect(swarmUpdateOutcome(undefined)).toEqual({ kind: "updating" });
    expect(swarmUpdateOutcome({ State: "updating" })).toEqual({ kind: "updating" });
    expect(swarmUpdateOutcome({ State: "rollback_started" })).toEqual({ kind: "updating" });
    expect(swarmUpdateOutcome({ State: "completed" })).toEqual({ kind: "completed" });
    expect(swarmUpdateOutcome({ State: "rollback_completed", Message: " task failed " })).toEqual({
      kind: "rolled-back",
      message: "task failed",
    });
    expect(swarmUpdateOutcome({ State: "paused", Message: "" })).toEqual({
      kind: "paused",
      message: null,
    });
    expect(swarmUpdateOutcome({ State: "rollback_paused" }).kind).toBe("paused");
  });
});

describe("awaitSwarmUpdate", () => {
  test("waits through `updating` until swarm reports the end", async () => {
    addService({ afterUpdate: ["updating", "updating", "completed"] });
    expect(await awaitSwarmUpdate(docker, "svc1", 30_000)).toEqual({ kind: "completed" });
  });

  test("gives up at its deadline, still updating", async () => {
    addService({ afterUpdate: ["updating"] });
    expect(await awaitSwarmUpdate(docker, "svc1", 50)).toEqual({ kind: "updating" });
  });
});

describe("rollBackSwarmService", () => {
  test("asks for rollback=previous and waits until swarm has rolled back", async () => {
    const svc = addService();
    expect(await rollBackSwarmService(docker, "svc1")).toBe(true);
    expect(svc.updates).toEqual([{ rollback: "previous" }]);
  });

  test("false when the service is gone", async () => {
    expect(await rollBackSwarmService(docker, "missing")).toBe(false);
  });
});

describe("awaitSwarmPort", () => {
  const plan = { timeoutMs: 1500, holdMs: 0, port: 3000, healthcheck: false };

  test("ready once the edge reaches the service", async () => {
    addEdge(true);
    expect(await awaitSwarmPort(docker, "acme-web", plan)).toBeNull();
  });

  test("nothing on the port for the window: the reason names it", async () => {
    addEdge(false);
    expect(await awaitSwarmPort(docker, "acme-web", plan)).toBe(
      "never became ready: nothing accepted a connection on port 3000 within 2s",
    );
  });

  test("no port declared: nothing to wait for", async () => {
    expect(await awaitSwarmPort(docker, "acme-web", { ...plan, port: null })).toBeNull();
  });
});

describe("settleSwarmUpdate", () => {
  test("a rollout swarm rolled back is a failure that names the task's error", async () => {
    addService({
      updateState: "rollback_completed",
      updateMessage: "update rolled back due to failure or early termination of task",
      tasks: [
        { state: "running", createdAt: "2026-10-07T10:00:00Z" },
        { state: "failed", err: "task: non-zero exit (1)", createdAt: "2026-10-07T10:01:00Z" },
      ],
    });
    const status = await settleSwarmUpdate(docker, spec(true), "svc1", "otterdeploy-acme");
    expect(status).toMatchObject({ status: "error", rolledBack: true });
    expect(status.errorMessage).toBe(
      "new version failed and swarm rolled it back: task: non-zero exit (1); the previous version keeps serving",
    );
  });

  test("a paused rollout is a failure without a rollback claim", async () => {
    addService({ updateState: "paused", updateMessage: "update paused due to failure" });
    const status = await settleSwarmUpdate(docker, spec(true), "svc1", "otterdeploy-acme");
    expect(status).toMatchObject({ status: "error", rolledBack: false });
    expect(status.errorMessage).toBe(
      "new version failed and the rollout is paused: update paused due to failure",
    );
  });

  test("completed with a healthcheck: swarm already gated it, the service runs", async () => {
    addService({ updateState: "completed" });
    const status = await settleSwarmUpdate(docker, spec(true), "svc1", "otterdeploy-acme");
    expect(status.status).toBe("running");
  });
});
