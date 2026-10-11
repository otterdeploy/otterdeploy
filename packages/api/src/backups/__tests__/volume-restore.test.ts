import { Docker, DockerServerError } from "@otterdeploy/docker";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const commands = vi.hoisted(() => new Array<string[]>());
vi.mock("../exec", () => ({
  execCapture: async (_docker: Docker, _id: string, cmd: string[]) => {
    commands.push(cmd);
    return { stdout: "", stderr: "", exitCode: 0 };
  },
}));
import { restoreVolumeFromTar } from "../volume";

afterEach(() => {
  vi.restoreAllMocks();
  commands.length = 0;
});

describe("volume restore staging", () => {
  it("never clears original bytes when helper creation fails", async () => {
    const docker = new Docker();
    const error = new DockerServerError({ message: "injected create failure" });
    vi.spyOn(docker.containers, "create").mockResolvedValue(Result.err(error));
    const run = vi
      .spyOn(docker, "run")
      .mockRejectedValue(new Error("destructive helper must not run"));
    await expect(restoreVolumeFromTar(docker, "original", Buffer.from("tar"))).rejects.toThrow(
      "injected create failure",
    );
    expect(run).not.toHaveBeenCalled();
    expect(commands).toEqual([]);
    docker.destroy();
  });
  it("does not commit if archive extraction fails", async () => {
    const docker = new Docker();
    const helper = docker.containers.getContainer("helper");
    vi.spyOn(docker.containers, "create").mockResolvedValue(Result.ok(helper));
    vi.spyOn(helper, "start").mockResolvedValue(Result.ok(undefined));
    vi.spyOn(helper, "remove").mockResolvedValue(Result.ok(undefined));
    vi.spyOn(helper, "putArchive").mockResolvedValue(
      Result.err(new DockerServerError({ message: "injected put failure" })),
    );
    await expect(restoreVolumeFromTar(docker, "original", Buffer.from("tar"))).rejects.toThrow(
      "injected put failure",
    );
    expect(commands.map((c) => c[0])).toEqual(["mkdir", "rm"]);
    expect(commands[1]?.[2]).toMatch(/^\/v\/\.otterdeploy-restore-/);
    docker.destroy();
  });
});

it("does not touch volume contents when starting the prepared helper fails", async () => {
  const docker = new Docker();
  const helper = docker.containers.getContainer("helper");
  vi.spyOn(docker.containers, "create").mockResolvedValue(Result.ok(helper));
  vi.spyOn(helper, "start").mockResolvedValue(
    Result.err(new DockerServerError({ message: "start failure" })),
  );
  vi.spyOn(helper, "remove").mockResolvedValue(Result.ok(undefined));
  await expect(restoreVolumeFromTar(docker, "original", Buffer.from("tar"))).rejects.toThrow(
    "start failure",
  );
  expect(commands.map((c) => c[0])).toEqual(["rm"]);
  docker.destroy();
});
