/**
 * Talk to the CrowdSec agent by exec'ing `cscli` inside its container over the
 * Docker socket the control plane already manages — no LAPI credentials, no host
 * networking. Two shapes:
 *   - `cscliRead`  : a TRUSTED fixed command (stderr dropped → clean JSON).
 *   - `cscliRun`   : a command that takes UNTRUSTED input — the values are passed
 *                    as POSITIONAL shell args ($1, $2, …), never interpolated, so
 *                    a hostile blocklist URL / reason can't inject shell.
 *
 * Execs run WITHOUT a TTY: `cscli decisions list` deadlocks when stdout is a
 * pty (observed on v1.7.8 — zero bytes, forever), so the attach stream arrives
 * in Docker's multiplexed framing and is demuxed here. Every exec also carries
 * a hard timeout: a wedged agent degrades to `null` ("agent unreachable")
 * instead of a forever-pending RPC that piles stuck cscli processes into the
 * container.
 */
import { Docker } from "@otterdeploy/docker";

/** Generous for a healthy agent (reads are <2s); small enough that a wedged
 *  agent reads as unreachable instead of hanging the Firewall view. */
const EXEC_TIMEOUT_MS = 30_000;

function collectStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
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
 * are concatenated in arrival order — same merged text the old TTY mode
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
async function execInCrowdsec(cmd: string[]): Promise<string | null> {
  const docker = Docker.fromEnv();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), EXEC_TIMEOUT_MS);
  });
  try {
    return await Promise.race([timedOut, run(docker, cmd)]);
  } finally {
    if (timer) clearTimeout(timer);
    docker.destroy();
  }
}

async function run(docker: Docker, cmd: string[]): Promise<string | null> {
  const list = await docker.containers.list({ filters: { name: ["crowdsec"] } });
  const container = list.isOk()
    ? list.value.find(
        (c) => c.State === "running" && (c.Names ?? []).some((n) => n.includes("crowdsec")),
      )
    : undefined;
  if (!container) return null;
  const exec = await docker.containers.getContainer(container.Id).exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });
  if (exec.isErr()) return null;
  const stream = await exec.value.start({});
  if (stream.isErr()) return null;
  return demuxDockerStream(await collectStream(stream.value));
}

/** Run a TRUSTED, fixed command with stderr suppressed — for clean JSON reads.
 *  `command` must NOT contain untrusted input. */
export function cscliRead(command: string): Promise<string | null> {
  return execInCrowdsec(["sh", "-lc", `${command} 2>/dev/null`]);
}

/** Run a command whose `script` references untrusted values as $1, $2, … —
 *  the values are passed as separate argv entries, so they're never parsed by
 *  the shell. Output is the merged stdout+stderr (so callers can read result
 *  messages like "Imported N decisions"). */
export function cscliRun(script: string, args: string[]): Promise<string | null> {
  // arg0 is a label; user values start at $1.
  return execInCrowdsec(["sh", "-lc", script, "crowdsec-exec", ...args]);
}
