/**
 * Shared mechanics for streaming a rustic snapshot's file into a command
 * running inside a container (hijacked exec duplex). Used by the in-place
 * restore path (pg_restore / mysql / mongorestore into the live container) and
 * by restore-proving verification (same stream into a throwaway sandbox).
 *
 * The dance is deadlock-sensitive: demux back-pressures stderr behind unread
 * stdout, so both output sides must be draining BEFORE the snapshot bytes are
 * piped into stdin; ending the duplex half-closes stdin (FIN) so the restore
 * client sees EOF, finishes, and its exit code becomes observable.
 */
import type { Docker } from "@otterdeploy/docker";
import type { Readable } from "node:stream";

import { demuxStream } from "@otterdeploy/docker";
import { Duplex } from "node:stream";

import type { RusticCli } from "./rustic";

function collect(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/**
 * Stream one snapshot file into `cmd` exec'd in the container, returning the
 * command's exit code + stderr. Never throws on a non-zero exit: the caller
 * owns the verdict (a restore fails hard, a verification records evidence).
 */
export async function streamIntoExec(input: {
  docker: Docker;
  containerId: string;
  cmd: string[];
  env: string[];
  write: (stdin: Duplex) => Promise<void>;
}): Promise<{ exitCode: number; stderr: string }> {
  const container = input.docker.containers.getContainer(input.containerId);
  const execResult = await container.exec({
    Cmd: input.cmd,
    Env: input.env,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });
  if (execResult.isErr()) throw execResult.error;
  const exec = execResult.value;

  const startResult = await exec.start({ Detach: false, Tty: false, stdin: true });
  if (startResult.isErr()) throw startResult.error;
  // `stdin: true` hijacks the connection, so the stream is a full Duplex; a
  // read-only stream is a driver bug.
  const duplex = startResult.value;
  if (!(duplex instanceof Duplex)) throw new Error("exec.start with stdin gave no writable stream");

  // A restore client can reject the archive before consuming stdin. Docker's
  // hijacked writable may otherwise wait forever for backpressure to clear.
  duplex.once("end", () => {
    if (!duplex.writableFinished)
      duplex.destroy(new Error("restore process closed stdin before the archive completed"));
  });
  const { stdout, stderr } = demuxStream(duplex);
  const stdoutDone = collect(stdout);
  const stderrDone = collect(stderr);

  try {
    const [, , stderrBytes] = await Promise.all([input.write(duplex), stdoutDone, stderrDone]);
    const inspect = await exec.inspect();
    if (inspect.isErr()) throw inspect.error;
    if (inspect.value.Running || inspect.value.ExitCode == null) {
      throw new Error("restore exec ended without a confirmed exit code");
    }
    return { exitCode: inspect.value.ExitCode, stderr: stderrBytes.toString("utf8") };
  } finally {
    duplex.destroy();
  }
}

/** Restore one rustic snapshot through the shared stdin transport. */
export async function streamSnapshotIntoExec(input: {
  docker: Docker;
  containerId: string;
  cmd: string[];
  env: string[];
  cli: RusticCli;
  snapshotId: string;
  filenameInSnapshot: string;
}): Promise<{ exitCode: number; stderr: string }> {
  return streamIntoExec({
    ...input,
    write: (out) =>
      input.cli.dumpToStream({
        snapshotId: input.snapshotId,
        filenameInSnapshot: input.filenameInSnapshot,
        out,
      }),
  });
}
