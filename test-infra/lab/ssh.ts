/**
 * SSH to lab nodes with the run's own key (never the operator's), through the
 * system `ssh`. Host keys are pinned per run in the run dir's known_hosts.
 */
import { Result } from "better-result";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { keyPath, runDir } from "./state";
import { describeCause, LabError, type LabResult, pollUntil } from "./support";

export interface CommandOutput {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(
  where: string,
  argv: string[],
  timeoutMs: number,
  stdin?: string,
): Promise<LabResult<CommandOutput>> {
  return Result.tryPromise({
    try: async () => {
      const proc = Bun.spawn(argv, {
        stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
        stdout: "pipe",
        stderr: "pipe",
        timeout: timeoutMs,
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { code, stdout, stderr };
    },
    catch: (cause) => new LabError(where, describeCause(cause)),
  });
}

export async function generateKeyPair(runId: string): Promise<LabResult<string>> {
  mkdirSync(runDir(runId), { recursive: true, mode: 0o700 });
  const path = keyPath(runId);
  const result = await run(
    "ssh-keygen",
    ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", `otterlab-${runId}`, "-f", path],
    30_000,
  );
  if (result.isErr()) return Result.err(result.error);
  if (result.value.code !== 0) return Result.err(new LabError("ssh-keygen", result.value.stderr));
  return Result.ok(await Bun.file(`${path}.pub`).text());
}

export class LabSsh {
  constructor(private readonly runId: string) {}

  private argv(host: string, command: string, tty: boolean): string[] {
    return [
      "ssh",
      // -tt: a pseudo-terminal even though our stdin is not one, i.e. what an
      // operator's interactive SSH session gives the remote command.
      ...(tty ? ["-tt"] : []),
      "-i",
      keyPath(this.runId),
      "-o",
      "BatchMode=yes",
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      `UserKnownHostsFile=${join(runDir(this.runId), "known_hosts")}`,
      "-o",
      "ConnectTimeout=8",
      "-o",
      "ServerAliveInterval=15",
      `root@${host}`,
      command,
    ];
  }

  /** Run `command` on `host`; returns the output whatever the exit code. */
  exec(
    host: string,
    command: string,
    timeoutMs = 120_000,
    stdin?: string,
  ): Promise<LabResult<CommandOutput>> {
    return run(`ssh ${host}`, this.argv(host, command, false), timeoutMs, stdin);
  }

  /** Like `exec`, but inside a remote pseudo-terminal (an interactive session). */
  execInTerminal(
    host: string,
    command: string,
    timeoutMs: number,
  ): Promise<LabResult<CommandOutput>> {
    return run(`ssh -tt ${host}`, this.argv(host, command, true), timeoutMs);
  }

  /** Run `command` and fail on a non-zero exit. */
  async must(host: string, command: string, timeoutMs = 120_000): Promise<LabResult<string>> {
    const result = await this.exec(host, command, timeoutMs);
    if (result.isErr()) return Result.err(result.error);
    if (result.value.code !== 0) {
      const tail = `${result.value.stdout}\n${result.value.stderr}`
        .trim()
        .split("\n")
        .slice(-15)
        .join("\n");
      return Result.err(
        new LabError(
          `ssh ${host}`,
          `\`${command.slice(0, 80)}\` exited ${result.value.code}:\n${tail}`,
        ),
      );
    }
    return Result.ok(result.value.stdout);
  }

  /** Wait until sshd answers and cloud-init has finished first boot. */
  waitReady(host: string, timeoutMs = 6 * 60_000): Promise<LabResult<true>> {
    return pollUntil(`ssh ready ${host}`, timeoutMs, 5_000, async () => {
      const result = await this.exec(
        host,
        "cloud-init status --wait >/dev/null 2>&1; echo ready",
        5 * 60_000,
      );
      if (result.isErr()) return Result.err(result.error);
      return Result.ok(result.value.stdout.includes("ready") ? true : undefined);
    });
  }
}
