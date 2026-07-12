import type { ServerWebSocket } from "bun";
import type { Context, MiddlewareHandler } from "hono";
import type { WSEvents } from "hono/ws";

import { log } from "evlog";
import { upgradeWebSocket } from "hono/bun";

import { authorizePty, type PtyActor } from "./auth";
import {
  decodeClientMessage,
  type PtyBackend,
  sampleLogger,
  sendControl,
  type StartArgs,
  startShell,
  type Target,
  toShellInput,
} from "./pty";

// ---------------------------------------------------------------------------
// WebSocket handler — wired by index.ts:
//   app.get("/pty", terminalWebSocketHandler);
// Auth + authorization run BEFORE the upgrade (see ./auth): a denial is a
// plain HTTP 401/403 and no socket ever opens. The post-upgrade wire protocol
// is unchanged.
// ---------------------------------------------------------------------------

// Resolve the target up front. Exactly one of `?container=` or `?host=1`
// must be present — never both, never neither.
function parseTarget(c: Context): Target | null {
  const containerId = c.req.query("container") || null;
  const hostFlag = c.req.query("host") === "1";

  return containerId ? { kind: "container", id: containerId } : hostFlag ? { kind: "host" } : null;
}

function ptyEvents(actor: PtyActor, target: Target | null): WSEvents {
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
          pty: { event: "ws-raw-missing", detail: "not running on Bun?" },
        });
        ws.close(1011, "ws.raw missing");
        return;
      }

      if (!target) {
        log.warn({ pty: { event: "missing-target-param" } });
        sendControl(ws, {
          type: "error",
          code: "MISSING_TARGET",
          message: "?container=<id> or ?host=1 required",
        });
        ws.close(1008, "target required");
        return;
      }

      const bpLog = sampleLogger({ every: 1000, windowMs: 5_000 });

      const args: StartArgs = {
        cols: state.cols,
        rows: state.rows,
        userId: actor.userId ?? undefined,
        onData: (chunk) => {
          // Bun ServerWebSocket.send: >0 = bytes sent, -1 = queued
          // (backpressure), 0 = dropped (socket closed or over
          // backpressureLimit). Writing into a dropped socket leaks the
          // PTY process — kill the backend when we see 0.
          const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
          const r = raw.send(bytes);
          if (r > 0) return;
          if (r === 0) {
            bpLog.warn("[pty] send dropped — disposing backend");
            state.backend?.dispose();
            state.backend = null;
            return;
          }
          bpLog.warn(`[pty] backpressure (buffered=${raw.getBufferedAmount()})`);
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

      const backend = await startShell(args, target);
      backend.match({
        ok: (b) => {
          state.backend = b;
        },
        err: (err) => {
          log.error({
            pty: { event: "backend-start-failed" },
            error: err.message,
            tag: err._tag,
          });
          sendControl(ws, {
            type: "error",
            code: "SPAWN_FAILED",
            message: err.message,
          });
          ws.close(1011, "spawn failed");
        },
      });
    },

    onMessage(evt, ws) {
      if (!state.backend) return;

      // Binary frame = PTY stdin. Raw bytes straight through.
      if (typeof evt.data !== "string") {
        state.backend.write(toShellInput(evt.data));
        return;
      }

      // Text frame = JSON control message.
      decodeClientMessage(evt.data).match({
        ok: (msg) => {
          switch (msg.type) {
            case "session:resize":
              state.cols = msg.cols;
              state.rows = msg.rows;
              state.backend?.resize(msg.cols, msg.rows);
              return;
            default: {
              const _exhaustive: never = msg.type;
              return _exhaustive;
            }
          }
        },
        err: (err) => {
          sendControl(ws, {
            type: "error",
            code: "INVALID_MESSAGE",
            message: err.message,
          });
        },
      });
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
}

export const terminalWebSocketHandler: MiddlewareHandler = async (c, next) => {
  // Non-upgrade requests fall through, matching upgradeWebSocket's own
  // behavior when no upgrade is possible.
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return next();

  const target = parseTarget(c);
  const authz = await authorizePty(c, target);

  if (authz.isErr()) {
    log.warn({
      pty: {
        event: "auth-denied",
        status: authz.error.status,
        detail: authz.error.message,
        target: target?.kind ?? "none",
      },
    });
    return c.json({ message: authz.error.message }, authz.error.status);
  }

  return upgradeWebSocket(c, ptyEvents(authz.value, target));
};
