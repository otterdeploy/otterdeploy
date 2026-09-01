/**
 * The host-shell backend: a PTY on the machine the UI promises, not inside the
 * control-plane container.
 *
 * Split out of pty.ts, which had grown past the file-length cap. The seam is
 * real rather than arbitrary, everything here exists to answer one question
 * ("are we containerized, and if so how do we get out?"), and pty.ts keeps the
 * backend surface, the container-exec path, and the message codecs.
 */

import type { Subprocess } from "bun";

import { env } from "@otterdeploy/env/server";
import { Result } from "better-result";
import { log } from "evlog";
import { existsSync, readFileSync } from "node:fs";

import type { PtyBackend, StartArgs } from "./pty-backend";

import { PtySpawnError, PtyTerminalUnavailableError } from "../../lib/errors";
import { attempt, buildBaseEnv, SHELL, USR_HOME } from "./pty-backend";

function killShell(proc: Subprocess, helperName: string | null): void {
  // Interactive zsh ignores SIGTERM. SIGHUP is what the kernel sends when the
  // controlling terminal disappears, which is what we want here. SIGKILL is
  // the belt-and-suspenders fallback.
  attempt(() => proc.kill("SIGHUP"), "kill-failed-sighup");

  setTimeout(() => {
    if (proc.exitCode !== null) return;
    attempt(() => proc.kill("SIGKILL"), "kill-failed-sigkill");
  }, 250).unref?.();

  // Killing `docker run` only detaches the CLIENT; the helper container (and
  // the nsenter'd shell in it) keeps running and `--rm` never fires because
  // the container never exits. That is exactly how a host-shell helper sat on
  // the production box for 11 days. Remove it by name; if the session ended
  // normally the container is already gone and this is a cheap no-op error.
  if (helperName) {
    const rm = Bun.spawn(["docker", "rm", "-f", helperName], {
      stdout: "ignore",
      stderr: "ignore",
    });
    void Result.tryPromise({
      try: () => rm.exited,
      catch: () => null,
    });
  }
}

/** True when this process is itself inside a container. In production the
 *  control plane runs as `otterdeploy-server-1`, so spawning a shell here would
 *  land in the CONTAINER (Alpine, no bash, none of the operator's files), not on
 *  the machine the UI promises. Docker writes /.dockerenv into every container;
 *  the cgroup check covers runtimes that don't. */
function runningInContainer(): boolean {
  if (existsSync("/.dockerenv")) return true;
  return Result.try(() => readFileSync("/proc/1/cgroup", "utf8"))
    .map((c) => /docker|containerd|kubepods/.test(c))
    .unwrapOr(false);
}

/** Shell script run once inside the host's namespaces. Resolves root's real
 *  login shell from /etc/passwd (bash on a normal box) rather than trusting
 *  $SHELL, which nsenter does NOT inherit. The helper container's environment
 *  is what survives, and there $SHELL is unset.
 *
 *  Deliberately NOT `exec login -f root`: once exec replaces this process any
 *  `|| fallback` after it is dead code, so when login fails, which it does
 *  here, exit 1, having no utmp/PAM context in this namespace. The session
 *  dies with a bare "process exited with code 1" and no way to recover. Errors
 *  are left on stderr so a future failure is visible in the terminal instead of
 *  silent. */
const HOST_LOGIN_SCRIPT = [
  "SH=$(getent passwd root 2>/dev/null | cut -d: -f7)",
  '[ -x "$SH" ] || SH=$(command -v bash || command -v sh)',
  "export HOME=/root USER=root LOGNAME=root",
  'cd "$HOME" 2>/dev/null || cd /',
  'exec "$SH" -l',
].join("; ");

/** Argv that re-enters PID 1's namespaces, giving a shell on the real host.
 *  Requires --privileged --pid=host, which is why it runs as a throwaway helper
 *  container rather than in-process (the control plane itself is deliberately
 *  unprivileged). This grants no access the caller didn't already have: the
 *  server mounts docker.sock, which is root-equivalent on the host by
 *  definition: it only makes the advertised behaviour real. Still gated behind
 *  the same step-up auth as before. `-w` inherits PID 1's cwd. */
function hostShellArgv(helperName: string): string[] {
  return [
    "docker",
    "run",
    "--rm",
    // Stable, session-scoped name so dispose can `docker rm -f` the helper
    // when killing the docker CLI alone would leak it (see killShell).
    "--name",
    helperName,
    "-i",
    "-t",
    // nsenter carries no environment across, so the helper's env is all the
    // shell gets. Without this the host shell comes up as a dumb terminal.
    "-e",
    "TERM=xterm-256color",
    // Lets prompts and tools that check for truecolor (starship, bat, modern
    // vim) use it; TERM alone advertises only 256 colours.
    "-e",
    "COLORTERM=truecolor",
    "--privileged",
    "--pid=host",
    "--net=host",
    "--ipc=host",
    "--uts=host",
    "--label",
    "otterdeploy.role=host-shell",
    env.OTTERDEPLOY_HOST_SHELL_IMAGE,
    "nsenter",
    "-t",
    "1",
    "-m",
    "-u",
    "-i",
    "-n",
    "-p",
    "-w",
    "--",
    "sh",
    "-c",
    HOST_LOGIN_SCRIPT,
  ];
}

export function startHostShell(
  args: StartArgs,
): Result<PtyBackend, PtySpawnError | PtyTerminalUnavailableError> {
  const childEnv = buildBaseEnv(args.userId);
  const containerized = runningInContainer();
  const helperName = containerized ? `od-host-shell-${crypto.randomUUID().slice(0, 8)}` : null;
  const argv = helperName ? hostShellArgv(helperName) : [SHELL];

  return Result.try({
    try: () =>
      Bun.spawn(argv, {
        // The helper's cwd comes from nsenter -w; only the in-process shell
        // needs one here, and $HOME may not exist inside the container.
        cwd: containerized ? undefined : USR_HOME,
        env: childEnv,
        terminal: {
          cols: args.cols,
          rows: args.rows,
          data: (_term, data) => args.onData(data),
        },
        onExit: (_proc, exitCode, signalCode) => {
          log.info({
            pty: { event: "host-shell-exit", exitCode, signal: signalCode },
          });
          args.onExit({
            exitCode: exitCode ?? null,
            signal: signalCode != null ? String(signalCode) : null,
          });
        },
      }),
    catch: (cause) => new PtySpawnError({ cause }),
  }).andThen((proc) => {
    log.info({
      pty: {
        event: "host-shell-spawned",
        pid: proc.pid,
        shell: containerized ? "nsenter-host" : SHELL,
      },
    });
    const term = proc.terminal;
    if (!term) return Result.err(new PtyTerminalUnavailableError());

    return Result.ok<PtyBackend>({
      write: (data) => term.write(data),
      resize: (cols, rows) => term.resize(cols, rows),
      dispose: () => {
        killShell(proc, helperName);
        attempt(() => term.close(), "terminal-close-failed");
      },
    });
  });
}
