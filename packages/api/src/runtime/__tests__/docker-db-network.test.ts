import { createId } from "@otterdeploy/shared/id";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";

import { type FakeDockerDaemon, startFakeDockerDaemon } from "../../__tests__/fake-docker-daemon";
import { runDatabase } from "../docker-driver-db";

const socket = vi.hoisted(() => {
  const path = `/tmp/otterdeploy-dbnet-${process.pid}.sock`;
  // oxlint-disable-next-line node/no-process-env -- daemon transport boundary
  process.env.DOCKER_HOST = `unix://${path}`;
  return path;
});
let daemon: FakeDockerDaemon;
beforeAll(() => {
  daemon = startFakeDockerDaemon(socket);
});
afterAll(() => daemon.stop());
beforeEach(() => {
  daemon.state.containers = [];
  daemon.state.networks = new Set([
    "otterdeploy-shop",
    "otterdeploy-shop.staging",
    "otterdeploy-shop.preview-one",
  ]);
  daemon.state.failing.clear();
});
const spec = () => ({
  engine: "postgres" as const,
  resourceId: createId("res"),
  projectSlug: "shop",
  serviceName: "db",
  volumeName: "actual-volume",
  hostnameAlias: "db.internal",
  databaseName: "db",
  username: "app",
  password: "secret",
  deploymentId: "",
  public: false,
  image: "otterdeploy-local/db:v1",
  networkScopeSuffix: "-staging",
});
it("database deploy joins only its scoped bridge", async () => {
  const result = await runDatabase(spec());
  expect(result.networkName).toBe("otterdeploy-shop.staging");
  expect(Object.keys(daemon.state.containers[0]?.networks ?? {})).toEqual([
    "otterdeploy-shop.staging",
  ]);
});
it("database recreation retains explicit shared-preview grants and their hostnames", async () => {
  daemon.addContainer({
    name: "db",
    networks: {
      "otterdeploy-shop.staging": { aliases: ["db.internal"] },
      "otterdeploy-shop.preview-one": { aliases: ["shared.internal"] },
    },
  });
  await runDatabase(spec());
  expect(daemon.state.containers[0]?.networks["otterdeploy-shop.preview-one"]?.aliases).toEqual([
    "shared.internal",
  ]);
});
it("cannot erase grants after an inspection failure or silently lose a failed reattachment", async () => {
  daemon.addContainer({
    name: "db",
    networks: { "otterdeploy-shop.preview-one": { aliases: ["shared.internal"] } },
  });
  daemon.state.failing.add("GET /containers/db/json");
  await expect(runDatabase(spec())).rejects.toThrow();
  expect(daemon.state.containers).toHaveLength(1);
  daemon.state.failing.clear();
  daemon.state.failing.add("POST /networks/otterdeploy-shop.preview-one/connect");
  await expect(runDatabase(spec())).rejects.toThrow();
});

it("database readiness waits for inspect health even when Docker list says running", async () => {
  daemon.state.onCreate = (container) => {
    container.health = "starting";
    setTimeout(() => {
      container.health = "healthy";
    }, 50);
  };
  const result = await runDatabase(spec());
  expect(result.health).toBe("healthy");
  daemon.state.onCreate = () => undefined;
});

it("does not report ready when the health inspection fails", async () => {
  daemon.state.onCreate = () => {
    daemon.state.failing.add("GET /containers/db/json");
  };
  try {
    await expect(runDatabase(spec())).rejects.toThrow();
  } finally {
    daemon.state.onCreate = () => undefined;
  }
});
