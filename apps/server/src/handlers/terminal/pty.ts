import type { Subprocess } from "bun";
import type { WSContext } from "hono/ws";
import type { Duplex } from "node:stream";

import { Docker } from "@otterdeploy/docker";
import { Result } from "better-result";
import { log } from "evlog";
import { env as nodeEnv } from "node:process";

import {
  PtyExecError,
  PtySpawnError,
  PtyTerminalUnavailableError,
  PtyMessageError,
} from "../../lib/errors";
import { ClientMessage, type ServerMessage } from "../../messages";

const SHELL = nodeEnv.SHELL || "bash";
const USR_HOME = nodeEnv.HOME || "/root";

const docker = Docker.fromEnv();

// Minimal shell environment. We deliberately do NOT inherit process.env —
// that would leak server-side secrets (DATABASE_URL, BETTER_AUTH_SECRET, …)
// into the user's shell. Loosen the allowlist if the dev shell needs more.
function buildBaseEnv(userId: string | undefined): Record<string, string> {
  const childEnv: Record<string, string> = {
    PATH: nodeEnv.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: nodeEnv.HOME ?? "/root",
    USER: nodeEnv.USER ?? "root",
    LOGNAME: nodeEnv.LOGNAME ?? nodeEnv.USER ?? "root",
    SHELL: nodeEnv.SHELL ?? "/bin/bash",
    LANG: nodeEnv.LANG ?? "C.UTF-8",
    LC_ALL: nodeEnv.LC_ALL ?? "C.UTF-8",
    TERM: "xterm-256color",
  };
  if (userId) childEnv.OTTERDEPLOY_USER = userId;
  return childEnv;
}

// Rate-limited logger. Backpressure / dropped-frame events come in floods —
// log the first event in each window, every Nth after, summarize at window end.
export function sampleLogger({ every, windowMs }: { every: number; windowMs: number }) {
  let count = 0;
  let windowStart = 0;
  return {
    warn(msg: string) {
      const now = Date.now();
      if (now - windowStart > windowMs) {
        if (count > 1)
          log.warn({
            pty: {
              event: "backpressure-sampled",
              detail: `suppressed ${count - 1} similar events`,
            },
          });
        windowStart = now;
        count = 0;
      }
      if (count === 0 || count % every === 0)
        log.warn({ pty: { event: "backpressure", detail: msg } });
      count++;
    },
  };
}

// Run a best-effort side effect and log if it threw. Used for cleanup paths
// where the caller cannot meaningfully recover but we still want a trail.
function attempt(fn: () => void, event: string): void {
  Result.try(fn).tapError((cause) =>
    log.error({
      pty: { event },
      error: cause instanceof Error ? cause.message : String(cause),
    }),
  );
}

// ---------------------------------------------------------------------------
// PtyBackend — uniform surface over host PTY and container exec
// ---------------------------------------------------------------------------

export interface PtyBackend {
  write: (data: string | Uint8Array) => void;
  resize: (cols: number, rows: number) => void;
  dispose: () => void;
}

export interface ExitInfo {
  exitCode: number | null;
  signal: string | null;
}

export interface StartArgs {
  cols: number;
  rows: number;
  userId?: string;
  onData: (chunk: string | Uint8Array) => void;
  onExit: (info: ExitInfo) => void;
}

export type StartError = PtySpawnError | PtyTerminalUnavailableError | PtyExecError;

// ---------------------------------------------------------------------------
// Host shell
// ---------------------------------------------------------------------------

function killShell(proc: Subprocess): void {
  // Interactive zsh ignores SIGTERM. SIGHUP is what the kernel sends when the
  // controlling terminal disappears, which is what we want here. SIGKILL is
  // the belt-and-suspenders fallback.
  attempt(() => proc.kill("SIGHUP"), "kill-failed-sighup");

  setTimeout(() => {
    if (proc.exitCode !== null) return;
    attempt(() => proc.kill("SIGKILL"), "kill-failed-sigkill");
  }, 250).unref?.();
}

function startHostShell(
  args: StartArgs,
): Result<PtyBackend, PtySpawnError | PtyTerminalUnavailableError> {
  const childEnv = buildBaseEnv(args.userId);

  return Result.try({
    try: () =>
      Bun.spawn([SHELL], {
        cwd: USR_HOME,
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
      pty: { event: "host-shell-spawned", pid: proc.pid, shell: SHELL },
    });
    const term = proc.terminal;
    if (!term) return Result.err(new PtyTerminalUnavailableError());

    return Result.ok<PtyBackend>({
      write: (data) => term.write(data),
      resize: (cols, rows) => term.resize(cols, rows),
      dispose: () => {
        killShell(proc);
        attempt(() => term.close(), "terminal-close-failed");
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Container exec
// ---------------------------------------------------------------------------

type StartContainerArgs = StartArgs & { containerId: string };

async function startContainerExec(
  args: StartContainerArgs,
): Promise<Result<PtyBackend, PtyExecError>> {
  const container = docker.containers.getContainer(args.containerId);

  return Result.gen(async function* () {
    const exec = yield* (
      await container.exec({
        Cmd: ["/bin/sh"],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Env: args.userId ? [`OTTERDEPLOY_USER=${args.userId}`] : undefined,
      })
    ).mapError((cause) => new PtyExecError({ step: "create", cause }));

    log.info({
      pty: {
        event: "exec-created",
        containerId: args.containerId,
        execId: exec.id,
      },
    });

    const stream = yield* (await exec.start({ stdin: true, Tty: true })).mapError(
      (cause) => new PtyExecError({ step: "start", cause }),
    );
    const duplex = stream as Duplex;

    // Initial resize is best-effort: the stream is already live, so we'd
    // rather log and continue than tear down a working session.
    const initialResize = await exec.resize({ h: args.rows, w: args.cols });
    if (initialResize.isErr()) {
      log.warn({
        pty: {
          event: "initial-exec-resize-failed",
          detail: initialResize.error.message,
        },
      });
    }

    duplex.on("data", (chunk: Buffer) => args.onData(chunk));
    duplex.on("end", () => {
      log.info({ pty: { event: "exec-stream-end", execId: exec.id } });
      // Docker exec stream end carries no exit code; inspect would be needed.
      args.onExit({ exitCode: null, signal: null });
    });
    duplex.on("error", (err: Error) => {
      log.error({
        pty: { event: "exec-stream-error" },
        error: err.message,
      });
      args.onExit({ exitCode: null, signal: null });
    });

    return Result.ok<PtyBackend>({
      write: (data) => duplex.write(data),
      resize: (cols, rows) => {
        void exec.resize({ h: rows, w: cols }).then((r) => {
          if (r.isErr()) {
            log.warn({
              pty: { event: "exec-resize-failed", detail: r.error.message },
            });
          }
        });
      },
      dispose: () => {
        attempt(() => duplex.end(), "duplex-end-failed");
        attempt(() => duplex.destroy(), "duplex-destroy-failed");
      },
    });
  });
}

export function toShellInput(raw: unknown): string | Buffer {
  if (typeof raw === "string") return raw;
  return Buffer.from(raw as ArrayBufferLike);
}

// Send a schema-typed control message as a JSON text frame. Control messages
// are low-frequency, so the void-returning WSContext.send is fine here —
// the PTY data hot path uses raw.send() for backpressure status instead.
export function sendControl(ws: WSContext, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}

export function decodeClientMessage(text: string): Result<ClientMessage, PtyMessageError> {
  return Result.try({
    try: () => JSON.parse(text) as unknown,
    catch: (cause) =>
      new PtyMessageError({
        reason: "invalid-json",
        message: "Invalid JSON",
        cause,
      }),
  }).andThen((value) => {
    const schema = ClientMessage.safeParse(value);
    if (!schema.success) {
      return Result.err(
        new PtyMessageError({
          reason: "invalid-schema",
          message: schema.error.issues[0]?.message ?? "Invalid message",
        }),
      );
    }
    return Result.ok(schema.data);
  });
}

export type Target = { kind: "container"; id: string } | { kind: "host" };

export async function startShell(
  args: StartArgs,
  target: Target,
): Promise<Result<PtyBackend, StartError>> {
  switch (target.kind) {
    case "container":
      return startContainerExec({ ...args, containerId: target.id });
    case "host":
      // Host-shell access is only reached via an explicit `?host=1` switch
      // — never as a silent fallback for missing parameters, since that
      // would let a frontend bug accidentally hand out a server shell.
      return startHostShell(args);
  }
}
