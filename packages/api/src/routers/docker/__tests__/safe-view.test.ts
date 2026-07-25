import { describe, expect, test } from "vite-plus/test";

import {
  redactSensitiveText,
  safeContainerInspect,
  safeImageInspect,
  safeNetworkInspect,
  safeVolumeInspect,
} from "../safe-view";

describe("Docker safe inspect views", () => {
  test("container view excludes control-plane secrets, commands, mounts and labels", () => {
    const safe = safeContainerInspect({
      Id: "container_server",
      Name: "/otterdeploy-server",
      Created: "2026-07-25T00:00:00Z",
      Image: "sha256:image",
      Platform: "linux",
      Driver: "overlay2",
      RestartCount: 2,
      Config: {
        Image: "otterdeploy/server:latest",
        Env: [
          "DATABASE_URL=postgres://admin:super-secret@db/control",
          "BETTER_AUTH_SECRET=auth-secret",
        ],
        Cmd: ["bun", "run", "server"],
        Entrypoint: ["/entrypoint.sh"],
        Labels: { "traefik.password": "label-secret" },
      },
      HostConfig: { Binds: ["/etc/otterdeploy:/run/secrets"] },
      Mounts: [{ Source: "/var/lib/otterdeploy", Destination: "/data" }],
      NetworkSettings: {
        Networks: { control: { IPAddress: "10.0.0.2", MacAddress: "00:00:00:00:00:01" } },
      },
      State: {
        Status: "running",
        Running: true,
        ExitCode: 0,
        StartedAt: "2026-07-25T00:01:00Z",
        Health: {
          Status: "healthy",
          FailingStreak: 0,
          Log: [{ Output: "BETTER_AUTH_SECRET=health-secret" }],
        },
      },
    });

    expect(safe).toMatchObject({
      id: "container_server",
      name: "otterdeploy-server",
      image: "otterdeploy/server:latest",
      state: { status: "running", running: true, health: "healthy" },
    });
    const serialized = JSON.stringify(safe);
    for (const forbidden of [
      "super-secret",
      "auth-secret",
      "label-secret",
      "health-secret",
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "/var/lib/otterdeploy",
      "/run/secrets",
      "entrypoint.sh",
      "10.0.0.2",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("image, volume and network views expose only allowlisted operational metadata", () => {
    const image = safeImageInspect({
      Id: "sha256:image",
      RepoTags: ["app:latest"],
      RepoDigests: ["app@sha256:digest"],
      Created: "2026-07-25T00:00:00Z",
      Architecture: "arm64",
      Os: "linux",
      Size: 123,
      Config: { Env: ["TOKEN=image-secret"], Labels: { secret: "label-secret" } },
      ContainerConfig: { Cmd: ["echo", "command-secret"] },
      History: [{ CreatedBy: "RUN --mount=type=secret secret-history" }],
    });
    const volume = safeVolumeInspect({
      Name: "database",
      Driver: "local",
      Scope: "local",
      CreatedAt: "2026-07-25T00:00:00Z",
      Mountpoint: "/var/lib/docker/volumes/database/_data",
      Labels: { password: "volume-secret" },
      Options: { device: "/sensitive/host/path" },
      Status: { token: "driver-secret" },
    });
    const network = safeNetworkInspect({
      Id: "network",
      Name: "private",
      Driver: "overlay",
      Scope: "swarm",
      IPAM: { Config: [{ Subnet: "10.0.0.0/24", Gateway: "10.0.0.1" }] },
      Containers: {
        secretContainerId: {
          Name: "customer-secret-service",
          IPv4Address: "10.0.0.9/24",
        },
      },
      Labels: { secret: "network-secret" },
      Options: { encryptedKey: "driver-secret" },
    });

    const serialized = JSON.stringify({ image, volume, network });
    expect(image).toMatchObject({ id: "sha256:image", architecture: "arm64", size: 123 });
    expect(volume).toEqual({
      name: "database",
      driver: "local",
      scope: "local",
      createdAt: "2026-07-25T00:00:00Z",
    });
    expect(network).toMatchObject({
      id: "network",
      attachedContainers: 1,
      subnets: [{ subnet: "10.0.0.0/24", gateway: "10.0.0.1" }],
    });
    for (const forbidden of [
      "image-secret",
      "label-secret",
      "command-secret",
      "secret-history",
      "/var/lib/docker",
      "/sensitive/host/path",
      "volume-secret",
      "customer-secret-service",
      "10.0.0.9",
      "network-secret",
      "driver-secret",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("Docker log redaction", () => {
  test.each([
    ["DATABASE_URL=postgres://admin:secret@db/app", "DATABASE_URL=[REDACTED]"],
    ['{"password":"hunter2","ok":true}', '{"password":[REDACTED],"ok":true}'],
    ["Authorization: Bearer abc.def-123", "Authorization: [REDACTED]"],
    ["token=otter_extremely-secret", "token=[REDACTED]"],
    ["connecting postgres://admin:secret@db/app", "connecting postgres://admin:[REDACTED]@db/app"],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature", "[REDACTED_JWT]"],
    ["QWxhZGRpbjpvcGVuIHNlc2FtZSBsb25nIHByaXZhdGUga2V5IGxpbmU=", "[REDACTED]"],
  ])("redacts %s", (input, expected) => {
    expect(redactSensitiveText(input)).toBe(expected);
  });

  test("leaves ordinary operational output readable", () => {
    expect(redactSensitiveText("server listening on 0.0.0.0:3000")).toBe(
      "server listening on 0.0.0.0:3000",
    );
  });
});
