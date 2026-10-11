import { describe, expect, it } from "vite-plus/test";

import {
  agentImageFor,
  comparePlatformImages,
  imageTag,
  platformRoleOf,
  projectOf,
} from "../platform-image";

const RELEASE = "ghcr.io/otterdeploy/server:v0.24.0";

const compose = (service: string, project = "otterdeploy") => ({
  "com.docker.compose.project": project,
  "com.docker.compose.service": service,
});

describe("agentImageFor", () => {
  it("runs the server's own image, not the configured release", () => {
    expect(agentImageFor({ image: "acme/server:branch", imageId: "sha256:a" }, RELEASE)).toBe(
      "acme/server:branch",
    );
  });

  it("falls back to the configured release when the server is not in a container", () => {
    expect(agentImageFor(null, RELEASE)).toBe(RELEASE);
  });
});

describe("platformRoleOf", () => {
  it("knows the server and builder of its own compose project, and the agent", () => {
    expect(platformRoleOf(compose("server"), "otterdeploy")).toBe("server");
    expect(platformRoleOf(compose("builder"), "otterdeploy")).toBe("builder");
    expect(platformRoleOf({ "otterdeploy.role": "health-agent" }, null)).toBe("health-agent");
  });

  it("ignores other services and other installs on the same daemon", () => {
    expect(platformRoleOf(compose("caddy"), "otterdeploy")).toBeNull();
    expect(platformRoleOf(compose("server", "someone-else"), "otterdeploy")).toBeNull();
  });

  it("reads a swarm stack's service names", () => {
    const labels = {
      "com.docker.stack.namespace": "otterdeploy",
      "com.docker.swarm.service.name": "otterdeploy_builder",
    };
    expect(platformRoleOf(labels, projectOf(labels))).toBe("builder");
  });
});

describe("comparePlatformImages", () => {
  it("flags an agent on the release while the server and builder run another build", () => {
    const server = { image: "acme/server:branch", imageId: "sha256:branch" };
    const rows = comparePlatformImages(server, "otterdeploy", [
      {
        name: "otterdeploy-health-agent.x1",
        labels: { "otterdeploy.managed": "true", "otterdeploy.role": "health-agent" },
        image: RELEASE,
        imageId: "sha256:release",
        state: "running",
      },
      {
        name: "otterdeploy-builder-1",
        labels: compose("builder"),
        image: "acme/server:branch",
        imageId: "sha256:branch",
        state: "running",
      },
      {
        name: "otterdeploy-server-1",
        labels: compose("server"),
        image: "acme/server:branch",
        imageId: "sha256:branch",
        state: "running",
      },
      {
        name: "otterdeploy-caddy-1",
        labels: compose("caddy"),
        image: "ghcr.io/otterdeploy/caddy:v0.24.0",
        imageId: "sha256:caddy",
        state: "running",
      },
    ]);
    expect(rows.map((r) => [r.role, r.matchesServer])).toEqual([
      ["server", true],
      ["builder", true],
      ["health-agent", false],
    ]);
  });

  it("calls the same tag on a different image id a different build", () => {
    const server = { image: "acme/server:branch", imageId: "sha256:new" };
    const [row] = comparePlatformImages(server, "otterdeploy", [
      {
        name: "otterdeploy-builder-1",
        labels: compose("builder"),
        image: "acme/server:branch",
        imageId: "sha256:old",
        state: "running",
      },
    ]);
    expect(row?.matchesServer).toBe(false);
  });
});

describe("imageTag", () => {
  it("reads the tag past a registry port and a digest", () => {
    expect(imageTag("registry:5000/acme/server:v1@sha256:abc")).toBe("v1");
    expect(imageTag("acme/server")).toBeNull();
  });
});
