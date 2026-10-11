import { Docker, DockerServerError, Exec } from "@otterdeploy/docker";
import { Result } from "better-result";
import { Duplex, Readable } from "node:stream";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vite-plus/test";

import { type FakeDockerDaemon, startFakeDockerDaemon } from "../../__tests__/fake-docker-daemon";
import { streamIntoExec } from "../restore-stream";

const socket = vi.hoisted(() => {
  const path = `/tmp/otterdeploy-stdin-${process.pid}.sock`;
  // oxlint-disable-next-line node/no-process-env -- test transport boundary
  process.env.DOCKER_HOST = `unix://${path}`;
  return path;
});
let daemon: FakeDockerDaemon;
let docker: Docker;
const fault = new DockerServerError({ message: "injected" });
beforeAll(() => {
  daemon = startFakeDockerDaemon(socket);
  daemon.addContainer({ name: "db" });
  docker = Docker.fromEnv();
});
afterAll(() => {
  docker.destroy();
  daemon.stop();
});
afterEach(() => {
  vi.restoreAllMocks();
  daemon.state.failing.clear();
});
const restore = () =>
  streamIntoExec({
    docker,
    containerId: "db",
    cmd: ["pg_restore"],
    env: [],
    write: async (stdin) => {
      stdin.end("archive");
    },
  });
function duplex() {
  return new Duplex({
    read() {
      this.push(null);
    },
    write(_chunk, _encoding, done) {
      done();
    },
  });
}
it("surfaces exec creation failure", async () => {
  daemon.state.failing.add("POST /containers/db/exec");
  await expect(restore()).rejects.toThrow("injected");
});
it("surfaces start failure", async () => {
  vi.spyOn(Exec.prototype, "start").mockResolvedValue(Result.err(fault));
  await expect(restore()).rejects.toThrow("injected");
});
it("refuses a read-only stream before writing archive bytes", async () => {
  vi.spyOn(Exec.prototype, "start").mockResolvedValue(Result.ok(Readable.from([])));
  await expect(restore()).rejects.toThrow("no writable stream");
});
it("requires successful exit inspection", async () => {
  vi.spyOn(Exec.prototype, "start").mockResolvedValue(Result.ok(duplex()));
  vi.spyOn(Exec.prototype, "inspect").mockResolvedValue(Result.err(fault));
  await expect(restore()).rejects.toThrow("injected");
});
it("refuses an unconfirmed exit", async () => {
  vi.spyOn(Exec.prototype, "start").mockResolvedValue(Result.ok(duplex()));
  vi.spyOn(Exec.prototype, "inspect").mockResolvedValue(Result.ok({ Running: true }));
  await expect(restore()).rejects.toThrow("confirmed exit code");
});
it("closes the duplex if the archive producer fails", async () => {
  const stream = duplex();
  vi.spyOn(Exec.prototype, "start").mockResolvedValue(Result.ok(stream));
  await expect(
    streamIntoExec({
      docker,
      containerId: "db",
      cmd: [],
      env: [],
      write: async () => {
        throw new Error("producer failure");
      },
    }),
  ).rejects.toThrow("producer failure");
  expect(stream.destroyed).toBe(true);
});

it("rejects promptly when the process exits while archive writes are backpressured", async () => {
  const stream = new Duplex({
    read() {
      this.push(null);
    },
    write() {
      /* peer never drains */
    },
  });
  vi.spyOn(Exec.prototype, "start").mockResolvedValue(Result.ok(stream));
  await expect(
    streamIntoExec({
      docker,
      containerId: "db",
      cmd: [],
      env: [],
      write: async (stdin) => {
        await new Promise<void>((resolve, reject) => {
          stdin.on("error", reject);
          stdin.end(Buffer.alloc(2 * 1024 * 1024), resolve);
        });
      },
    }),
  ).rejects.toThrow("closed stdin");
}, 1000);
