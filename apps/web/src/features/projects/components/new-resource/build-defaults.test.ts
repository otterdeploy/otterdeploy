import { describe, expect, it } from "vite-plus/test";

import {
  buildSummary,
  defaultBuilder,
  defaultPort,
  defaultServiceType,
  portDefaultHint,
  type RepoDetection,
  resolvedBuilder,
} from "./build-defaults";

const IT_TOOLS: RepoDetection = {
  framework: "vite",
  dockerfile: { path: "Dockerfile", exposedPorts: [80] },
};
const NEXT_NO_DOCKERFILE: RepoDetection = { framework: "next", dockerfile: null };

describe("build-defaults", () => {
  it("a root Dockerfile is the default build, railpack the fallback", () => {
    expect(defaultBuilder(IT_TOOLS)).toBe("dockerfile");
    expect(defaultBuilder(NEXT_NO_DOCKERFILE)).toBe("railpack");
  });

  it("auto-resolving builder ids follow the same rule the build worker uses", () => {
    expect(resolvedBuilder("buildpack", IT_TOOLS)).toBe("dockerfile");
    expect(resolvedBuilder("buildpack", NEXT_NO_DOCKERFILE)).toBe("railpack");
    expect(resolvedBuilder("railpack", IT_TOOLS)).toBe("railpack");
  });

  it("the service type follows the builder: a Dockerfile repo is a web app", () => {
    expect(defaultServiceType(IT_TOOLS)).toBe("app");
    expect(defaultServiceType({ framework: "vite", dockerfile: null })).toBe("static");
  });

  it("the port comes from EXPOSE for a Dockerfile build, else the framework", () => {
    expect(defaultPort("dockerfile", IT_TOOLS)).toEqual({ port: 80, source: "dockerfile" });
    expect(defaultPort("railpack", NEXT_NO_DOCKERFILE)).toEqual({
      port: 3000,
      source: "framework",
    });
    // A Dockerfile without EXPOSE falls back to the framework port.
    const noExpose: RepoDetection = {
      framework: "go",
      dockerfile: { path: "Dockerfile", exposedPorts: [] },
    };
    expect(defaultPort("dockerfile", noExpose)).toEqual({ port: 8080, source: "framework" });
    expect(defaultPort("railpack", IT_TOOLS)).toBeNull();
  });

  it("says where the port default came from", () => {
    expect(portDefaultHint("dockerfile", IT_TOOLS)).toBe(
      "Port 80 prefilled from EXPOSE in /Dockerfile.",
    );
    expect(portDefaultHint("railpack", NEXT_NO_DOCKERFILE)).toContain(
      "Detected Next.js. Port 3000",
    );
    expect(
      portDefaultHint("dockerfile", {
        framework: null,
        dockerfile: { path: "api/Dockerfile", exposedPorts: [] },
      }),
    ).toBe("/api/Dockerfile declares no EXPOSE. Set the port your image listens on.");
  });

  it("the review names the builder that will run", () => {
    expect(buildSummary("app", "dockerfile", IT_TOOLS)).toBe("Dockerfile · /Dockerfile");
    expect(buildSummary("app", "railpack", IT_TOOLS)).toBe("Railpack · auto-detected");
    expect(buildSummary("static", "dockerfile", IT_TOOLS)).toBe(
      "Railpack · static site served by Caddy",
    );
  });
});
