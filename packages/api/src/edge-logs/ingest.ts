/**
 * Edge-log ingest sink. Caddy's per-site `log { output net … ; format json }`
 * opens a TCP connection and streams newline-delimited JSON access entries to
 * this listener. We frame on newlines, parse, and push into the ring buffer.
 *
 * `output net` is symmetric across environments — dev (Caddy in a container →
 * host.docker.internal) and Swarm (service DNS) differ only by the address,
 * exactly like DEPLOY_AUTHZ_UPSTREAM. No shared filesystem assumption.
 */

import { log } from "evlog";

import { parseCaddyEvent } from "./event-parse";
import { pushEdgeEvent } from "./event-ring";
import { lookupCountry } from "./geo";
import { parseCaddyAccessLog } from "./parse";
import { enqueueEdgeLog } from "./persist";
import { pushEdgeLog } from "./ring";

// Bound once across `--hot` reloads via a global guard (the listener is a
// long-lived TCP server — re-`Bun.listen`ing the same port would EADDRINUSE,
// and the existing listener's data handler already writes into the shared
// globalThis ring/persist state, so it stays correct after reload).
const g = globalThis as typeof globalThis & {
  __edgeLogSink?: { stop: (closeActiveConnections?: boolean) => void };
};

export function startEdgeLogSink(port: number): void {
  if (g.__edgeLogSink) return;
  const partials = new WeakMap<object, { buf: string }>();

  g.__edgeLogSink = Bun.listen({
    hostname: "0.0.0.0",
    port,
    socket: {
      open(socket) {
        partials.set(socket, { buf: "" });
      },
      data(socket, chunk) {
        const state = partials.get(socket) ?? { buf: "" };
        state.buf += chunk.toString();
        let nl = state.buf.indexOf("\n");
        while (nl !== -1) {
          const line = state.buf.slice(0, nl).trim();
          state.buf = state.buf.slice(nl + 1);
          if (line) ingestLine(line);
          nl = state.buf.indexOf("\n");
        }
        partials.set(socket, state);
      },
      close(socket) {
        partials.delete(socket);
      },
      error(_socket, err) {
        log.error({ edgeLog: { sink: "socket-error" }, error: err.message });
      },
    },
  });

  log.info({ edgeLog: { sink: "listening", port } });
}

/** Both planes share this socket: per-site access logs (their own logger) and
 *  the global default logger (operational events). Access logs use the
 *  `http.log.access.*` logger and Caddy's "handled request" message — route
 *  those to the access path, everything else to the event path. Without this
 *  split, a reverse_proxy error (which embeds a `request`) would mis-parse as
 *  a status-0 access row. */
function isAccessLog(json: unknown): boolean {
  if (typeof json !== "object" || json === null) return false;
  const o = json as Record<string, unknown>;
  const logger = typeof o.logger === "string" ? o.logger : "";
  return logger.includes("log.access") || o.msg === "handled request";
}

function ingestLine(line: string): void {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return; // Caddy runtime log lines that aren't JSON, or partial — skip.
  }

  if (isAccessLog(json)) {
    const parsed = parseCaddyAccessLog(json);
    if (!parsed) return;
    // GeoIP enrichment (null until a database is configured — see geo.ts).
    parsed.country = lookupCountry(parsed.clientIp);
    pushEdgeLog(parsed); // live tail
    enqueueEdgeLog(parsed); // persistence (no-op unless started)
    return;
  }

  // Operational log plane (Phase 3): cert/ACME, upstream errors, etc. Live
  // tail only (no persistence) — parse drops info-level noise.
  const event = parseCaddyEvent(json);
  if (event) pushEdgeEvent(event);
}

export function stopEdgeLogSink(): void {
  g.__edgeLogSink?.stop();
  g.__edgeLogSink = undefined;
}
