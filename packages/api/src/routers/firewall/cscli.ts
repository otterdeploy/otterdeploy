/**
 * Talk to the CrowdSec agent by exec'ing `cscli` inside its container over the
 * Docker socket the control plane already manages, no LAPI credentials, no host
 * networking. Two shapes:
 *   - `cscliRead`  : a TRUSTED fixed command (stderr dropped → clean JSON).
 *   - `cscliRun`   : a command that takes UNTRUSTED input. The values are passed
 *                    as POSITIONAL shell args ($1, $2, …), never interpolated, so
 *                    a hostile blocklist URL / reason can't inject shell.
 *
 * Execs run WITHOUT a TTY: `cscli decisions list` deadlocks when stdout is a
 * pty (observed on v1.7.8, zero bytes, forever), so the attach stream arrives
 * in Docker's multiplexed framing and is demuxed here. Every exec also carries
 * a hard timeout: a wedged agent degrades to `null` ("agent unreachable")
 * instead of a forever-pending RPC that piles stuck cscli processes into the
 * container.
 */
import type { JsonObject } from "@otterdeploy/shared/json";

import { Docker } from "@otterdeploy/docker";
import { isJsonObject } from "@otterdeploy/shared/json";
import { Result } from "better-result";

/** Generous for a healthy agent (reads are <2s); small enough that a wedged
 *  agent reads as unreachable instead of hanging the Firewall view. */
const EXEC_TIMEOUT_MS = 30_000;

/** Buffer a whole (finite) attach stream. Shared with the migrate router's
 *  container execs. */
export function collectStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const done = () => resolve(Buffer.concat(chunks));
    stream.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
    stream.on("end", done);
    stream.on("close", done);
    stream.on("error", done);
  });
}

/**
 * Demultiplex a non-TTY docker attach stream: frames of
 * `[stream(1), 0, 0, 0, len(u32 BE)]` + payload. stdout and stderr payloads
 * are concatenated in arrival order. Same merged text the old TTY mode
 * produced. Falls back to the raw text when the buffer isn't mux-framed.
 * Exported for tests.
 */
export function demuxDockerStream(buf: Buffer): string {
  const first = buf[0];
  const framed =
    buf.length >= 8 && (first === 0 || first === 1 || first === 2) && buf.readUIntBE(1, 3) === 0;
  if (!framed) return buf.toString("utf8");
  const parts: Buffer[] = [];
  let off = 0;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off + 4);
    const start = off + 8;
    parts.push(buf.subarray(start, Math.min(start + len, buf.length)));
    off = start + len;
  }
  return Buffer.concat(parts).toString("utf8");
}

/** Find the running crowdsec container + exec `cmd` in it. Null when absent,
 *  on exec failure, or past the timeout. */
async function execInCrowdsec(
  cmd: string[],
  timeoutMs = EXEC_TIMEOUT_MS,
  input?: string,
): Promise<string | null> {
  const docker = Docker.fromEnv();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([timedOut, run(docker, cmd, input, timeoutMs)]);
  } finally {
    if (timer) clearTimeout(timer);
    docker.destroy();
  }
}

/**
 * Run a command in the crowdsec container with data on STDIN, via the docker
 * CLI rather than the Docker HTTP API.
 *
 * The API path (exec + AttachStdin + a hijacked duplex) delivers the payload:
 * cscli genuinely imports the decisions, but the response stream comes back
 * EMPTY and `exec.inspect()` reports a null exit code, so the caller cannot
 * tell success from failure. That made every managed-blocklist import look
 * rejected while its decisions were live in CrowdSec, and the caller then
 * deleted the blocklist row (od bead: blocklist enable false failure).
 *
 * Reads and non-stdin execs over the API are unaffected, so only this one shape
 * is routed around it. The CLI ships in the server image (it is how the builder
 * drives buildx) and speaks the same socket.
 */
async function runViaCli(
  containerId: string,
  cmd: string[],
  input: string,
  timeoutMs: number,
): Promise<string | null> {
  const proc = Bun.spawn(["docker", "exec", "-i", containerId, ...cmd], {
    stdin: new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    // stdout+stderr merged: callers match on cscli's result text, which it
    // writes across both.
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    return `${out}${err}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function run(
  docker: Docker,
  cmd: string[],
  input: string | undefined,
  timeoutMs: number,
): Promise<string | null> {
  const list = await docker.containers.list({ filters: { name: ["crowdsec"] } });
  const container = list.isOk()
    ? list.value.find(
        (c) => c.State === "running" && (c.Names ?? []).some((n) => n.includes("crowdsec")),
      )
    : undefined;
  if (!container) return null;
  // Anything with stdin goes through the CLI. See runViaCli for why.
  if (input !== undefined) return runViaCli(container.Id, cmd, input, timeoutMs);
  const exec = await docker.containers.getContainer(container.Id).exec({
    Cmd: cmd,
    AttachStdin: input !== undefined,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });
  if (exec.isErr()) return null;
  const stream = await exec.value.start(input === undefined ? {} : { stdin: true });
  if (stream.isErr()) return null;
  const output = collectStream(stream.value);
  if (input !== undefined) {
    // The exec stream is duplex when stdin was attached; the static type
    // doesn't carry `end`, so duck-check instead of casting.
    const writable: unknown = stream.value;
    if (
      typeof writable === "object" &&
      writable !== null &&
      "end" in writable &&
      typeof writable.end === "function"
    ) {
      writable.end(input);
    }
  }
  return demuxDockerStream(await output);
}

/** Run a TRUSTED, fixed command with stderr suppressed. For clean JSON reads.
 *  `command` must NOT contain untrusted input. The in-container `timeout`
 *  kills the process itself: without it, an abandoned slow query (e.g. the
 *  /v1/alerts scan behind `cscli decisions list`) keeps grinding the agent at
 *  full CPU long after the server-side race has given up. */
export function cscliRead(command: string): Promise<string | null> {
  return execInCrowdsec(["sh", "-lc", `timeout 25 ${command} 2>/dev/null`]);
}

/** Run a command whose `script` references untrusted values as $1, $2, ….
 *  The values are passed as separate argv entries, so they're never parsed by
 *  the shell. Output is the merged stdout+stderr (so callers can read result
 *  messages like "Imported N decisions"). */
export function cscliRun(
  script: string,
  args: string[],
  opts?: { timeoutMs?: number; input?: string },
): Promise<string | null> {
  // arg0 is a label; user values start at $1.
  return execInCrowdsec(
    ["sh", "-lc", script, "crowdsec-exec", ...args],
    opts?.timeoutMs,
    opts?.input,
  );
}

/**
 * Parse `cscli … -o json` output into rows.
 *
 * Lives here rather than in either reader because both need the same three
 * concessions to how cscli prints: an empty result is the literal string
 * `null`, malformed output must not throw into a request, and anything that
 * isn't an array of objects is "nothing", not an error.
 *
 * The caller distinguishes "could not read" (a `null` from `cscliRead` /
 * `cscliRun`) from "read fine, nothing matched" (an empty array from here).
 * Collapsing those would let a wedged agent read as "no decisions".
 */
export function parseCscliJson(text: string | null): JsonObject[] {
  if (!text) return [];
  const trimmed = text.trim();
  if (!trimmed || trimmed === "null") return [];
  const parsed = Result.try({
    try: (): unknown => JSON.parse(trimmed),
    catch: () => null,
  });
  if (parsed.isErr() || !Array.isArray(parsed.value)) return [];
  return parsed.value.filter(isJsonObject);
}
