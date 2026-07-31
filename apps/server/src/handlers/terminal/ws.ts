import type { TerminalTicketClaims } from "@otterdeploy/api/routers/terminal/tickets";
import type { ServerWebSocket } from "bun";
import type { MiddlewareHandler } from "hono";
import type { WSEvents } from "hono/ws";

import { recordTerminalShellAudit } from "@otterdeploy/api/audit/terminal";
import { consumeTerminalTicket, ticketBindingIp } from "@otterdeploy/api/routers/terminal/tickets";
import { env } from "@otterdeploy/env/server";
import { log } from "evlog";
import { upgradeWebSocket } from "hono/bun";

import { isTrustedOrigin } from "./origin";
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
// WebSocket handler — wired by index.ts: app.get("/pty", terminalWebSocketHandler);
//
// od-5j8.9 redesign. The upgrade no longer authenticates from ambient
// cookies/bearer tokens at all — it:
//   1. Validates Origin against the configured control-plane origin(s)
//      (kills cross-site WebSocket hijacking outright — see ./origin.ts).
//   2. Consumes a single-use ticket (`?ticket=…`, minted by the authenticated,
//      step-up-verified `terminal.mintTicket` oRPC call — see
//      packages/api/src/routers/terminal/{index,tickets,authorize}.ts). The
//      ticket already carries the authorized target; the upgrade no longer
//      accepts a client-supplied `?container=`/`?host=1` at all, so there is
//      nothing left for a client to substitute.
// A denial at either step is a plain HTTP 401/403 — the socket never opens
// and no backend is spawned.
// ---------------------------------------------------------------------------

function targetLabel(target: Target): { kind: "container" | "host"; id: string } {
  return target.kind === "container"
    ? { kind: "container", id: target.id }
    : { kind: "host", id: "host" };
}

function ptyEvents(claims: TerminalTicketClaims, target: Target): WSEvents {
  const state = {
    backend: null as PtyBackend | null,
    cols: 80,
    rows: 24,
    // Recorded once — a real backend either started (open worth auditing) or
    // never did (nothing to audit a close for).
    opened: false,
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

      const bpLog = sampleLogger({ every: 1000, windowMs: 5_000 });

      const args: StartArgs = {
        cols: state.cols,
        rows: state.rows,
        userId: claims.userId,
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
          state.opened = true;
          void recordTerminalShellAudit({
            action: "terminal.open",
            organizationId: claims.organizationId,
            userId: claims.userId,
            target: targetLabel(target),
            outcome: "success",
          }).catch((cause) => {
            log.error({ pty: { event: "audit-write-failed" }, error: String(cause) });
          });
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
          void recordTerminalShellAudit({
            action: "terminal.open",
            organizationId: claims.organizationId,
            userId: claims.userId,
            target: targetLabel(target),
            outcome: "failure",
            reason: err.message,
          }).catch((cause) => {
            log.error({ pty: { event: "audit-write-failed" }, error: String(cause) });
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
      if (state.opened) {
        void recordTerminalShellAudit({
          action: "terminal.close",
          organizationId: claims.organizationId,
          userId: claims.userId,
          target: targetLabel(target),
          outcome: "success",
        }).catch((cause) => {
          log.error({ pty: { event: "audit-write-failed" }, error: String(cause) });
        });
      }
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

  // 1. Origin — cheap, and the one check a malicious cross-site page can
  // never spoof. Runs before touching Redis.
  const origin = c.req.header("origin");
  if (!isTrustedOrigin(origin, env.CORS_ORIGIN, c.req.header("host"))) {
    log.warn({
      pty: { event: "origin-rejected", origin: origin ?? "(missing)" },
    });
    return c.json({ message: "Origin not allowed" }, 403);
  }

  // 2. Single-use ticket — the only accepted proof of authorization. No
  // cookie/bearer/API-key fallback: this transport authenticates real users
  // only, via `terminal.mintTicket` (session + step-up already verified
  // there). No `?container=`/`?host=1` either — the target comes exclusively
  // from the ticket, so there is no client-controlled field left to
  // substitute a different target into.
  const ticket = c.req.query("ticket");
  if (!ticket) {
    log.warn({ pty: { event: "ticket-missing" } });
    return c.json({ message: "Missing ticket" }, 401);
  }

  // Same derivation the mint side used — `ticketBindingIp` is deliberately the
  // single source for both ends (see its doc comment for why X-Forwarded-For
  // alone made every upgrade fail with ip_mismatch behind Cloudflare).
  const consumed = await consumeTerminalTicket(ticket, {
    clientIp: ticketBindingIp(c.req.raw.headers),
  });
  if (consumed.isErr()) {
    log.warn({
      pty: { event: "ticket-rejected", reason: consumed.error.reason },
    });
    return c.json({ message: consumed.error.message }, consumed.error.status);
  }

  const claims = consumed.value;
  const target: Target =
    claims.target.kind === "container"
      ? { kind: "container", id: claims.target.id }
      : { kind: "host" };

  return upgradeWebSocket(c, ptyEvents(claims, target));
};
