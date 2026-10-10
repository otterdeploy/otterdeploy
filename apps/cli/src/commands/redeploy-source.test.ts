/**
 * `otd redeploy` on an upload-built service said it "runs a prebuilt image"
 * and told the operator to change its image tag. `service.build` refuses
 * anything but git, and the CLI read every refusal as "image". The service's own source decides instead.
 */
import { describe, expect, test, vi } from "vite-plus/test";

const abortSpy = vi.fn((message: string, ...hints: string[]): never => {
  throw new Error([message, ...hints].join(" | "));
});
const uploadSpy = vi.fn(async (_args: { resourceId: string; name: string }) => ({
  deploymentId: "dep_rebuilt",
}));

vi.mock("../lib/ui", () => ({
  abort: (message: string, ...hints: string[]) => abortSpy(message, ...hints),
  note: () => undefined,
}));
vi.mock("../lib/deploy-run", () => ({
  uploadServiceSource: (args: { resourceId: string; name: string }) => uploadSpy(args),
}));
vi.mock("../auth-flow", () => ({
  ensureAuthenticated: async (url: string) => ({ url, token: "tok" }),
}));
vi.mock("../config-file", () => ({
  configExists: () => true,
  configPath: () => "/work/laptop-ship/otterdeploy.yaml",
  loadConfig: async () => ({ project: "laptop-ship", services: { web: { source: "upload" } } }),
}));

const { nonGitRedeploy, redeployNonGit } = await import("./redeploy-source");

function target(source: string) {
  return {
    url: "https://cp.example",
    projectId: "proj_1",
    projectSlug: "laptop-ship",
    resourceId: "res_web",
    resourceName: "web",
    client: {
      project: {
        manifest: { get: async () => ({ manifest: { services: { web: { source } } } }) },
      },
    },
  };
}

describe("redeployNonGit", () => {
  test("rebuilds an upload-built service from its project directory", async () => {
    await expect(redeployNonGit(target("upload"), { json: true })).resolves.toBe("dep_rebuilt");
    expect(uploadSpy).toHaveBeenCalledWith(expect.objectContaining({ resourceId: "res_web" }));
  });

  test("still says an image-sourced service runs a prebuilt image", async () => {
    await expect(redeployNonGit(target("image"), { json: true })).rejects.toThrow(
      /runs a prebuilt image/,
    );
  });
});

const HERE = { project: "laptop-ship", source: "upload" };

describe("nonGitRedeploy", () => {
  test("an upload-built service in its own project directory is rebuilt from it", () => {
    expect(
      nonGitRedeploy({ serverSource: "upload", local: HERE, projectSlug: "laptop-ship" }),
    ).toBe("upload-here");
  });

  test("an upload-built service is never called a prebuilt image, wherever the CLI runs", () => {
    expect(
      nonGitRedeploy({ serverSource: "upload", local: null, projectSlug: "laptop-ship" }),
    ).toBe("upload-elsewhere");
    expect(
      nonGitRedeploy({
        serverSource: "upload",
        local: { project: "other", source: "upload" },
        projectSlug: "laptop-ship",
      }),
    ).toBe("upload-elsewhere");
  });

  test("an image-sourced service has nothing to rebuild", () => {
    expect(nonGitRedeploy({ serverSource: "image", local: HERE, projectSlug: "laptop-ship" })).toBe(
      "image",
    );
    expect(nonGitRedeploy({ serverSource: undefined, local: null, projectSlug: "x" })).toBe(
      "image",
    );
  });
});
