import { Docker } from "@otterdeploy/docker";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";

import { type FakeDockerDaemon, startFakeDockerDaemon } from "../../__tests__/fake-docker-daemon";
import { dockerDriver } from "../docker-driver";
import { ensureBridgeNetwork } from "../docker-driver-helpers";
import { moveToScopedNetwork } from "../docker-network-migration";
import { networkSuffixForOwner } from "../docker-network-reconcile";
import { setPreviewDatabaseAccess } from "../preview-network-access";

const socket = vi.hoisted(() => {
  const path = `/tmp/otterdeploy-isolation-${process.pid}.sock`;
  // oxlint-disable-next-line node/no-process-env -- daemon transport boundary
  process.env.DOCKER_HOST = `unix://${path}`;
  return path;
});
let daemon: FakeDockerDaemon;
let docker: Docker;
beforeAll(() => {
  daemon = startFakeDockerDaemon(socket);
  docker = Docker.fromEnv();
});
afterAll(() => {
  docker.destroy();
  daemon.stop();
});
beforeEach(() => {
  daemon.state.containers = [];
  daemon.state.networks = new Set([
    "otterdeploy-shop",
    "otterdeploy-shop.staging",
    "otterdeploy-shop.preview-one",
  ]);
  daemon.state.failing.clear();
});

it("creates different bridges for production, staging and previews", async () => {
  expect(await ensureBridgeNetwork(docker, "shop")).toBe("otterdeploy-shop");
  expect(await ensureBridgeNetwork(docker, "shop", "-staging")).toBe("otterdeploy-shop.staging");
  expect(await ensureBridgeNetwork(docker, "shop", "-preview-one")).toBe(
    "otterdeploy-shop.preview-one",
  );
});
it("idempotent provision migrates a running legacy container with aliases intact", async () => {
  const c = daemon.addContainer({
    name: "shop-web-staging",
    networks: { "otterdeploy-shop": { aliases: ["db", "legacy.internal"] } },
  });
  const result = await dockerDriver.provision({
    resourceId: "res_1",
    projectSlug: "shop",
    networkScopeSuffix: "-staging",
    serviceName: c.name,
    resourceName: "web-staging",
    internalHostname: "web-staging.internal",
    image: "unused",
    env: {},
    replicas: 1,
    restart: { condition: "on-failure", delayMs: 1000 },
    ports: [],
    mounts: [],
    forceUpdateCounter: 0,
  });
  expect(result.networkName).toBe("otterdeploy-shop.staging");
  expect(c.networks["otterdeploy-shop"]).toBeUndefined();
  expect(c.networks["otterdeploy-shop.staging"]?.aliases).toEqual(
    expect.arrayContaining(["legacy.internal", "web-staging.internal"]),
  );
});
it("a failed new attachment retains the old network and reports failure", async () => {
  const c = daemon.addContainer({
    name: "staging",
    networks: { "otterdeploy-shop": { aliases: ["db"] } },
  });
  daemon.state.failing.add("POST /networks/otterdeploy-shop.staging/connect");
  await expect(
    moveToScopedNetwork(docker, c.id, "shop", "otterdeploy-shop.staging"),
  ).rejects.toThrow();
  expect(c.networks["otterdeploy-shop"]).toBeDefined();
});
it("a failed detach cannot report isolation; retry completes the transition", async () => {
  const c = daemon.addContainer({
    name: "staging",
    networks: { "otterdeploy-shop": { aliases: ["db"] } },
  });
  daemon.state.failing.add("POST /networks/otterdeploy-shop/disconnect");
  await expect(
    moveToScopedNetwork(docker, c.id, "shop", "otterdeploy-shop.staging"),
  ).rejects.toThrow();
  daemon.state.failing.clear();
  await moveToScopedNetwork(docker, c.id, "shop", "otterdeploy-shop.staging");
  expect(Object.keys(c.networks)).toEqual(["otterdeploy-shop.staging"]);
});

it("network creation and missing-container inspection failures are surfaced", async () => {
  daemon.state.failing.add("POST /networks/create");
  await expect(ensureBridgeNetwork(docker, "absent")).rejects.toThrow();
  await expect(
    moveToScopedNetwork(docker, "absent", "shop", "otterdeploy-shop.staging"),
  ).rejects.toThrow();
});

it("preserves explicit shared database aliases and revokes sharing once branched", async () => {
  const c = daemon.addContainer({
    name: "db",
    networks: { "otterdeploy-shop": { aliases: ["db.internal"] } },
  });
  const network = "otterdeploy-shop.preview-one";
  await setPreviewDatabaseAccess(docker, c.id, network, ["db.internal"]);
  expect(c.networks[network]?.aliases).toEqual(["db.internal"]);
  expect(c.networks["otterdeploy-shop"]).toBeDefined();
  await setPreviewDatabaseAccess(docker, c.id, network, null);
  expect(c.networks[network]).toBeUndefined();
});
it("never hides failures to inspect, grant or revoke preview access", async () => {
  const c = daemon.addContainer({ name: "db" });
  const network = "otterdeploy-shop.preview-one";
  await expect(setPreviewDatabaseAccess(docker, "missing", network, [])).rejects.toThrow();
  daemon.state.failing.add(`POST /networks/${network}/connect`);
  await expect(setPreviewDatabaseAccess(docker, c.id, network, [])).rejects.toThrow();
  daemon.state.failing.clear();
  await setPreviewDatabaseAccess(docker, c.id, network, []);
  daemon.state.failing.add(`POST /networks/${network}/disconnect`);
  await expect(setPreviewDatabaseAccess(docker, c.id, network, null)).rejects.toThrow();
});
it("unknown ownership never silently maps to the production bridge", () => {
  const row = { environmentId: null, mainId: null, environmentSlug: null };
  expect(() => networkSuffixForOwner("c", row, "missing", undefined)).toThrow("preview missing");
  expect(() =>
    networkSuffixForOwner("c", { ...row, environmentId: "missing" }, null, undefined),
  ).toThrow("environment missing");
});

it("cannot alias another project's main network through an environment suffix", async () => {
  daemon.state.networks.add("otterdeploy-shop-staging");
  const scoped = await ensureBridgeNetwork(docker, "shop", "-staging");
  const otherProject = await ensureBridgeNetwork(docker, "shop-staging");
  expect(scoped).not.toBe(otherProject);
});
