/**
 * Run a trusted, fixed shell script ON THE HOST from inside the control-plane
 * container: a short-lived privileged helper container (same "helper container
 * over the docker socket" idiom as the self-updater in routers/system/apply.ts)
 * nsenters PID 1's namespaces, so the host's own binaries run against the host
 * kernel — no userland/kernel version skew. Used for `zpool`/`zfs`, which only
 * exist on the host.
 *
 * The helper image is read raw off process.env (not `@otterdeploy/env`) so the
 * runtime driver can import this transitively without dragging full env
 * validation into the deploy import graph — same idiom as runtime/snapshot.
 */
import { Docker, DockerNotFoundError } from "@otterdeploy/docker";
import { Result } from "better-result";
import { Writable } from "node:stream";

import { pullImage } from "../runtime/docker-driver-helpers";

function helperImage(): string {
  // oxlint-disable-next-line node/no-process-env -- intentional raw read (see module note)
  return process.env.OTTERDEPLOY_UPDATE_HELPER_IMAGE || "docker:28-cli";
}

export interface HostRun {
  exitCode: number;
  output: string;
}

/** Run `script` on the host and capture its merged stdout+stderr. The script
 *  must be trusted, fixed text — never interpolate user input into it. */
export async function runOnHost(script: string): Promise<Result<HostRun, Error>> {
  const docker = Docker.fromEnv();
  try {
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    const spec = {
      // Enter the host's namespaces so host binaries run against the host
      // kernel module.
      Entrypoint: ["nsenter", "-t", "1", "-m", "-u", "-n", "-i", "--"],
      // Tty merges stdout+stderr into one clean stream (no mux framing) —
      // same trick as the firewall cscli exec.
      Tty: true,
      Labels: { "otterdeploy.role": "host-helper" },
      HostConfig: {
        Privileged: true,
        PidMode: "host",
        RestartPolicy: { Name: "no" as const },
      },
      autoRemove: true,
    };
    const cmd = ["sh", "-c", script];
    let ran = await docker.run(helperImage(), cmd, sink, spec);
    if (ran.isErr() && ran.error instanceof DockerNotFoundError) {
      // Helper image not local yet — pull once, retry once.
      await pullImage(docker, helperImage());
      ran = await docker.run(helperImage(), cmd, sink, spec);
    }
    if (ran.isErr()) return Result.err(new Error(ran.error.message));
    return Result.ok({
      exitCode: ran.value.output.StatusCode,
      output: Buffer.concat(chunks).toString("utf8"),
    });
  } finally {
    docker.destroy();
  }
}
