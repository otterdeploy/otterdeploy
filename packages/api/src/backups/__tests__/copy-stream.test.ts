import { Docker } from "@otterdeploy/docker";
import { Writable } from "node:stream";
import { describe, expect, it, vi } from "vite-plus/test";

const streamed = vi.hoisted(() => ({
  bytes: Buffer.alloc(0),
  cmd: new Array<string>(),
  exitCode: 0,
}));
vi.mock("../restore-stream", () => ({
  streamIntoExec: async (input: { cmd: string[]; write: (out: Writable) => Promise<void> }) => {
    streamed.cmd = input.cmd;
    const chunks: Buffer[] = [];
    await input.write(
      new Writable({
        write(chunk: Buffer, _encoding, done) {
          chunks.push(chunk);
          done();
        },
      }),
    );
    streamed.bytes = Buffer.concat(chunks);
    return { exitCode: streamed.exitCode, stderr: "injected restore failure" };
  },
}));
import { pgRestoreFromBuffer } from "../copy";

describe("copy restore stdin", () => {
  it("streams a >1 MiB archive byte-for-byte without putting it in argv", async () => {
    streamed.exitCode = 0;
    const archive = Buffer.alloc(2 * 1024 * 1024, 0xa5);
    const docker = new Docker();
    await pgRestoreFromBuffer(
      docker,
      "branch",
      { username: "a' b", databaseName: "db", password: "secret" },
      archive,
      "branch",
    );
    expect(streamed.bytes.equals(archive)).toBe(true);
    expect(streamed.cmd).toEqual([
      "pg_restore",
      "--clean",
      "--if-exists",
      "--no-owner",
      "-U",
      "a' b",
      "-d",
      "db",
    ]);
    docker.destroy();
  });
  it("rejects a failed pg_restore", async () => {
    streamed.exitCode = 7;
    const docker = new Docker();
    await expect(
      pgRestoreFromBuffer(
        docker,
        "branch",
        { username: "app", databaseName: "db", password: "secret" },
        Buffer.from("dump"),
        "branch",
      ),
    ).rejects.toThrow("exit 7");
    docker.destroy();
  });
});
