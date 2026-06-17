/**
 * Talk to the CrowdSec agent by exec'ing `cscli` inside its container over the
 * Docker socket the control plane already manages — no LAPI credentials, no host
 * networking. Two shapes:
 *   - `cscliRead`  : a TRUSTED fixed command (stderr dropped → clean JSON).
 *   - `cscliRun`   : a command that takes UNTRUSTED input — the values are passed
 *                    as POSITIONAL shell args ($1, $2, …), never interpolated, so
 *                    a hostile blocklist URL / reason can't inject shell.
 */
import { Docker } from "@otterdeploy/docker";

function collectStream(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const done = () => resolve(Buffer.concat(chunks).toString("utf8"));
    stream.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
    stream.on("end", done);
    stream.on("close", done);
    stream.on("error", done);
  });
}

/** Find the running crowdsec container + exec `cmd` in it. Null when absent. */
async function execInCrowdsec(cmd: string[]): Promise<string | null> {
  const docker = Docker.fromEnv();
  const list = await docker.containers.list({ filters: { name: ["crowdsec"] } });
  const container =
    list.isOk()
      ? list.value.find(
          (c) =>
            c.State === "running" &&
            (c.Names ?? []).some((n) => n.includes("crowdsec")),
        )
      : undefined;
  if (!container) {
    docker.destroy();
    return null;
  }
  const exec = await docker.containers.getContainer(container.Id).exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    // Tty merges stdout+stderr into one clean stream (no 8-byte mux framing).
    Tty: true,
  });
  if (exec.isErr()) {
    docker.destroy();
    return null;
  }
  const stream = await exec.value.start({});
  if (stream.isErr()) {
    docker.destroy();
    return null;
  }
  const out = await collectStream(stream.value);
  docker.destroy();
  return out;
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
export function cscliRun(
  script: string,
  args: string[],
): Promise<string | null> {
  // arg0 is a label; user values start at $1.
  return execInCrowdsec(["sh", "-lc", script, "crowdsec-exec", ...args]);
}
