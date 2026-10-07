/**
 * Port probes for the readiness gate (readiness.ts), shared by both runtimes.
 *
 * The probe runs from the EDGE's side of the network: a TCP connect (`nc -z`)
 * executed inside the edge (Caddy) container, which sits on every project
 * network. That is exactly the path traffic takes, so an app bound to
 * 127.0.0.1, or listening on another port, reads as closed however healthy it
 * looks from inside its own container. `unavailable` means the probe itself
 * could not run (no edge container in dev, no `nc` in a custom edge image):
 * callers fall back or skip, they never fail a deploy on it.
 */
import type { Readable } from "node:stream";

import { type Docker, demuxStream } from "@otterdeploy/docker";
import { Result } from "better-result";

import type { Listener, PortProbe } from "./readiness";

import { findEdgeContainerId } from "../swarm/client";
import { parseListeners } from "./readiness";

/** Seconds `nc` waits for the connect before calling the port closed. */
const PORT_PROBE_TIMEOUT_S = 2;
/** `nc` printed its usage: this build has no `-z`, so it cannot probe. */
const NC_UNSUPPORTED = /usage|invalid option|unrecognized option|not found/i;

interface ExecOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function collect(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

/** Run `cmd` in a container. Err when the exec could not run or its exit code
 *  cannot be read: a probe must never mistake "unknown" for "open". */
async function execIn(
  docker: Docker,
  containerId: string,
  cmd: string[],
): Promise<Result<ExecOutcome, Error>> {
  const created = await docker.containers
    .getContainer(containerId)
    .exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true, Tty: false });
  if (created.isErr()) return Result.err(created.error);
  const started = await created.value.start({ Detach: false, Tty: false });
  if (started.isErr()) return Result.err(started.error);
  const { stdout, stderr } = demuxStream(started.value);
  const output = await Result.tryPromise({
    try: () => Promise.all([collect(stdout), collect(stderr)]),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
  if (output.isErr()) return Result.err(output.error);
  const inspected = await created.value.inspect();
  if (inspected.isErr()) return Result.err(inspected.error);
  const exitCode = inspected.value.ExitCode;
  if (exitCode === undefined || inspected.value.Running) {
    return Result.err(new Error("exec exit code unavailable"));
  }
  const [out, err] = output.value;
  return Result.ok({ exitCode, stdout: out, stderr: err });
}

/** Can the edge open a TCP connection to `host:port`? */
export async function probeEdgePort(
  docker: Docker,
  host: string,
  port: number,
): Promise<PortProbe> {
  const edge = await findEdgeContainerId(docker);
  if (!edge) return "unavailable";
  const probe = await execIn(docker, edge, [
    "nc",
    "-z",
    "-w",
    String(PORT_PROBE_TIMEOUT_S),
    host,
    String(port),
  ]);
  if (probe.isErr()) return "unavailable";
  if (probe.value.exitCode === 0) return "open";
  if (probe.value.exitCode === 1 && !NC_UNSUPPORTED.test(probe.value.stderr)) return "closed";
  return "unavailable";
}

/** A container's listening TCP sockets, null when they cannot be read (the
 *  image has no `cat`, or the container is not running). */
export async function readContainerListeners(
  docker: Docker,
  containerId: string,
): Promise<Listener[] | null> {
  // tcp6 may be absent (IPv6 off): cat still prints tcp and exits 1.
  const read = await execIn(docker, containerId, ["cat", "/proc/net/tcp", "/proc/net/tcp6"]);
  if (read.isErr() || !read.value.stdout.includes("local_address")) return null;
  return parseListeners(read.value.stdout);
}
