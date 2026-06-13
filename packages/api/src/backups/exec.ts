/**
 * Container exec for the backup engine. Resolves a swarm service to one of its
 * running task containers and runs a command there, demuxing stdout/stderr.
 *
 * Swarm-reachability (the open question in docs/designs/backups.md §8.1): we
 * exec INSIDE the database's own task container via the Docker API rather than
 * connecting over the overlay network from the control plane. On a single-node
 * swarm the manager can reach every task; multi-node exec routing is a Docker
 * daemon concern, not ours. This keeps creds off the wire — pg_dump runs next
 * to the socket and streams its archive back over the exec channel.
 */
import { Docker, demuxStream } from "@otterdeploy/docker";
import type { Readable } from "node:stream";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Find a running container backing a swarm service by its service name. */
export async function findServiceContainerId(
  docker: Docker,
  serviceName: string,
): Promise<string | null> {
  const result = await docker.containers.list({
    all: false, // running only
    filters: { label: [`com.docker.swarm.service.name=${serviceName}`] },
  });
  if (result.isErr()) throw result.error;
  const running = result.value.find((c) => c.State === "running");
  return running?.Id ?? null;
}

/** Run a command in a container, buffering stdout/stderr to strings. Throws on
 *  a non-zero exit unless `allowNonZero` is set. */
export async function execCapture(
  docker: Docker,
  containerId: string,
  cmd: string[],
  opts: { env?: string[]; allowNonZero?: boolean } = {},
): Promise<ExecResult> {
  const container = docker.containers.getContainer(containerId);
  const execResult = await container.exec({
    Cmd: cmd,
    Env: opts.env,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });
  if (execResult.isErr()) throw execResult.error;
  const exec = execResult.value;

  const startResult = await exec.start({ Detach: false, Tty: false });
  if (startResult.isErr()) throw startResult.error;
  const stream = startResult.value as Readable;

  const { stdout, stderr } = demuxStream(stream);
  const [out, err] = await Promise.all([
    collect(stdout),
    collect(stderr),
  ]);

  const inspectResult = await exec.inspect();
  const exitCode = inspectResult.isOk()
    ? (inspectResult.value.ExitCode ?? 0)
    : 0;

  if (exitCode !== 0 && !opts.allowNonZero) {
    throw new Error(
      `Command exited ${exitCode}: ${err.toString("utf8").slice(0, 2000)}`,
    );
  }
  return {
    exitCode,
    stdout: out.toString("utf8"),
    stderr: err.toString("utf8"),
  };
}

/**
 * Run a command and return its raw stdout buffer (binary-safe) plus stderr as
 * text. Used for `pg_dump` where stdout is the archive bytes. The exec is
 * fully buffered: fine for typical app databases, but a streaming-to-storage
 * path is the next step for very large dumps (noted in the engine).
 */
export async function execDump(
  docker: Docker,
  containerId: string,
  cmd: string[],
  env: string[],
): Promise<{ exitCode: number; archive: Buffer; stderr: string }> {
  const container = docker.containers.getContainer(containerId);
  const execResult = await container.exec({
    Cmd: cmd,
    Env: env,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });
  if (execResult.isErr()) throw execResult.error;
  const exec = execResult.value;

  const startResult = await exec.start({ Detach: false, Tty: false });
  if (startResult.isErr()) throw startResult.error;
  const stream = startResult.value as Readable;

  const { stdout, stderr } = demuxStream(stream);
  const [archive, err] = await Promise.all([collect(stdout), collect(stderr)]);

  const inspectResult = await exec.inspect();
  const exitCode = inspectResult.isOk()
    ? (inspectResult.value.ExitCode ?? 0)
    : 0;

  return { exitCode, archive, stderr: err.toString("utf8") };
}

function collect(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
