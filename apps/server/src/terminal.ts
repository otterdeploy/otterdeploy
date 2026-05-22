import { Docker } from "@otterdeploy/docker";
import { Result } from "better-result";
import { log } from "evlog";
import type { ServerWebSocket, Subprocess } from "bun";
import type { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import type { Duplex } from "node:stream";
import { ClientMessage, type ServerMessage } from "./messages";

const SHELL = process.env.SHELL || "bash";
const USR_HOME = process.env.HOME || "/root";

const docker = Docker.fromEnv();

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

// Minimal shell environment. We deliberately do NOT inherit process.env —
// that would leak server-side secrets (DATABASE_URL, BETTER_AUTH_SECRET, …)
// into the user's shell. Loosen the allowlist if the dev shell needs more.
function buildBaseEnv(userId: string | undefined): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME ?? "/root",
    USER: process.env.USER ?? "root",
    LOGNAME: process.env.LOGNAME ?? process.env.USER ?? "root",
    SHELL: process.env.SHELL ?? "/bin/bash",
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
    TERM: "xterm-256color",
  };
  if (userId) env.OTTERSTACK_USER = userId;
  return env;
}

// Rate-limited logger. Backpressure / dropped-frame events come in floods —
// log the first event in each window, every Nth after, summarize at window end.
function sampleLogger({
  every,
  windowMs,
}: {
  every: number;
  windowMs: number;
}) {
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

// ---------------------------------------------------------------------------
// PtyBackend — uniform surface over host PTY and container exec
// ---------------------------------------------------------------------------

type PtyBackend = {
  write: (data: string | Uint8Array) => void;
  resize: (cols: number, rows: number) => void;
  dispose: () => void;
};

type ExitInfo = { exitCode: number | null; signal: string | null };

type StartArgs = {
  cols: number;
  rows: number;
  userId?: string;
  onData: (chunk: string | Uint8Array) => void;
  onExit: (info: ExitInfo) => void;
};

// ---------------------------------------------------------------------------
// Host shell
// ---------------------------------------------------------------------------

function killShell(proc: Subprocess): void {
  // Interactive zsh ignores SIGTERM. SIGHUP is what the kernel sends when the
  // controlling terminal disappears, which is what we want here. SIGKILL is
  // the belt-and-suspenders fallback.

  Result.try(() => proc.kill("SIGHUP")).tapError(() =>
    log.error({ pty: { event: "kill-failed", signal: "SIGHUP" } }),
  );

  setTimeout(() => {
    if (proc.exitCode !== null) return;
    Result.try(() => proc.kill("SIGKILL")).tapError(() =>
      log.error({ pty: { event: "kill-failed", signal: "SIGKILL" } }),
    );
  }, 250).unref?.();
}

function startHostShell(args: StartArgs): Result<PtyBackend, Error> {
  const env = buildBaseEnv(args.userId);

  return Result.try({
    try: () =>
      Bun.spawn([SHELL], {
        cwd: USR_HOME,
        env,
        terminal: {
          cols: args.cols,
          rows: args.rows,
          data: (_term, data) => args.onData(data),
        },
        onExit: (_proc, exitCode, signalCode) => {
          log.info({
            pty: {
              event: "host-shell-exit",
              exitCode,
              signal: signalCode,
            },
          });
          args.onExit({
            exitCode: exitCode ?? null,
            signal: signalCode != null ? String(signalCode) : null,
          });
        },
      }),
    catch: (cause) =>
      cause instanceof Error
        ? cause
        : new Error(`host shell spawn failed: ${String(cause)}`),
  }).map((proc) => {
    log.info({
      pty: { event: "host-shell-spawned", pid: proc.pid, shell: SHELL },
    });
    const term = proc.terminal;

    if (!term) throw new Error("terminal not available");

    return {
      write: (data) => term.write(data),
      resize: (cols, rows) => term.resize(cols, rows),
      dispose: () => {
        killShell(proc);
        Result.try(() => term.close()).tapError(() =>
          log.error({ pty: { event: "terminal-close-failed" } }),
        );
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Container exec
// ---------------------------------------------------------------------------

type StartContainerArgs = StartArgs & { containerId: string };

async function startContainerExec(
  args: StartContainerArgs,
): Promise<Result<PtyBackend, Error>> {
  const container = docker.containers.getContainer(args.containerId);

  const createRes = await container.exec({
    Cmd: ["/bin/sh"],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    Env: args.userId ? [`OTTERSTACK_USER=${args.userId}`] : undefined,
  });
  if (createRes.isErr()) {
    return Result.err(
      new Error(`exec create failed: ${createRes.error.message}`),
    );
  }
  const exec = createRes.value;
  log.info({
    pty: {
      event: "exec-created",
      containerId: args.containerId,
      execId: exec.id,
    },
  });

  const startRes = await exec.start({ stdin: true, Tty: true });
  if (startRes.isErr()) {
    return Result.err(
      new Error(`exec start failed: ${startRes.error.message}`),
    );
  }
  const duplex = startRes.value as Duplex;

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
    log.error(err, { pty: { event: "exec-stream-error" } });
    args.onExit({ exitCode: null, signal: null });
  });

  return Result.ok({
    write: (data) => duplex.write(data),
    resize: (cols, rows) => {
      exec.resize({ h: rows, w: cols }).then((r) => {
        if (r.isErr()) {
          log.warn({
            pty: { event: "exec-resize-failed", detail: r.error.message },
          });
        }
      });
    },
    dispose: () => {
      Result.try(() => duplex.end()).tapError(() => {
        log.error({ pty: { event: "duplex-end-failed" } });
      });
      Result.try(() => duplex.destroy()).tapError(() => {
        log.error({ pty: { event: "duplex-destroy-failed" } });
      });
    },
  });
}

function toShellInput(raw: unknown): string | Buffer {
  if (typeof raw === "string") return raw;
  return Buffer.from(raw as ArrayBufferLike);
}

// Send a schema-typed control message as a JSON text frame. Control messages
// are low-frequency, so the void-returning WSContext.send is fine here —
// the PTY data hot path uses raw.send() for backpressure status instead.
function sendControl(ws: WSContext, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}

async function startShell(args: StartArgs, id?: string | null) {
  return id
    ? await startContainerExec({ ...args, containerId: id })
    : startHostShell(args);
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export function registerTerminalRoutes(app: Hono): void {
  app.get(
    "/pty",
    async (c, next) => {
      // const session = await auth.api.getSession({ headers: c.req.raw.headers });
      // if (!session?.user) return c.text("unauthorized", 401);
      // c.set("userId", session.user.id);
      await next();
    },
    upgradeWebSocket((c) => {
      const userId = c.get("userId") as string | undefined;
      const containerId = c.req.query("container") || null;

      const state = {
        backend: null as PtyBackend | null,
        cols: 80,
        rows: 24,
      };

      return {
        async onOpen(_evt, ws) {
          const raw = ws.raw as ServerWebSocket<unknown> | undefined;
          if (!raw) {
            log.error({
              pty: {
                event: "ws-raw-missing",
                detail: "not running on Bun?",
              },
            });
            ws.close(1011, "ws.raw missing");
            return;
          }

          const bpLog = sampleLogger({ every: 1000, windowMs: 5_000 });

          const args: StartArgs = {
            cols: state.cols,
            rows: state.rows,
            userId,
            onData: (chunk) => {
              // Bun ServerWebSocket.send: >0 = bytes sent, -1 = queued
              // (backpressure), 0 = dropped (socket closed or over
              // backpressureLimit). Writing into a dropped socket leaks the
              // PTY process — kill the backend when we see 0.
              const bytes =
                typeof chunk === "string"
                  ? new TextEncoder().encode(chunk)
                  : chunk;
              const r = raw.send(bytes);
              if (r > 0) return;
              if (r === 0) {
                bpLog.warn("[pty] send dropped — disposing backend");
                state.backend?.dispose();
                state.backend = null;
                return;
              }
              bpLog.warn(
                `[pty] backpressure (buffered=${raw.getBufferedAmount()})`,
              );
            },
            onExit: (info) => {
              sendControl(ws, {
                type: "session:exit",
                exitCode: info.exitCode,
                signal: info.signal,
              });
              ws.close(1000, "session ended");
            },
          };

          const backendResult = await startShell(args, containerId);

          if (backendResult.isErr()) {
            log.error(backendResult.error, {
              pty: { event: "backend-start-failed" },
            });
            sendControl(ws, {
              type: "error",
              code: "SPAWN_FAILED",
              message: backendResult.error.message,
            });
            ws.close(1011, "spawn failed");
            return;
          }

          state.backend = backendResult.value;
        },

        onMessage(evt, ws) {
          if (!state.backend) return;

          // Binary frame = PTY stdin. Raw bytes straight through.
          if (typeof evt.data !== "string") {
            state.backend.write(toShellInput(evt.data));
            return;
          }

          // Text frame = JSON control message.
          let parsed: unknown;
          try {
            parsed = JSON.parse(evt.data);
          } catch {
            sendControl(ws, {
              type: "error",
              code: "INVALID_MESSAGE",
              message: "Invalid JSON",
            });
            return;
          }

          const result = ClientMessage.safeParse(parsed);
          if (!result.success) {
            sendControl(ws, {
              type: "error",
              code: "INVALID_MESSAGE",
              message: result.error.issues[0]?.message ?? "Invalid message",
            });
            return;
          }

          const msg = result.data;
          switch (msg.type) {
            case "session:resize":
              state.cols = msg.cols;
              state.rows = msg.rows;
              state.backend.resize(msg.cols, msg.rows);
              return;
            default: {
              const _exhaustive: never = msg.type;
              return _exhaustive;
            }
          }
        },

        onClose() {
          log.info({ pty: { event: "ws-close" } });
          state.backend?.dispose();
          state.backend = null;
        },

        onError() {
          log.info({ pty: { event: "ws-error" } });
          state.backend?.dispose();
          state.backend = null;
        },
      };
    }),
  );
}
