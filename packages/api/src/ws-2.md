# WebSocket + PTY Implementation Guide

A guide for implementing typed, validated WebSocket clients and servers, with a dedicated section for PTY (terminal-over-WS) applications.

## Stack

- **Runtime:** Bun
- **Server framework:** [Hono](https://hono.dev) with the `hono/bun` adapter (`upgradeWebSocket` + `websocket` exports)
- **PTY:** any node-pty-compatible library. **Do not use `Bun.spawn({ terminal })` or `Bun.Terminal`** — flaky in practice, POSIX-only per the official docs, and broken on Windows. Pick one:
  - [`bun-pty`](https://github.com/sursaone/bun-pty) — Rust-backed via Bun FFI, Bun-native
  - [`@lydell/node-pty`](https://github.com/lydell/node-pty) — maintained `node-pty` fork with current ConPTY support, works in Bun
  - [`node-pty`](https://github.com/microsoft/node-pty) — the original; cross-platform; may need rebuild
  - All three expose the same `IPty` interface (`spawn`, `.onData`, `.write`, `.resize`, `.kill`, `.onExit`), so the patterns below are library-agnostic.
- **Client:** [wterm](https://github.com/vercel-labs/wterm) (`@wterm/dom`) with [`@wterm/ghostty`](https://github.com/vercel-labs/wterm/tree/main/packages/@wterm/ghostty) core (libghostty WASM) for full VT compliance. Native browser `WebSocket`.
- **Validation:** Zod (swap for Valibot or ArkType — patterns identical).
- **TypeScript** with `strict: true` and `noUncheckedIndexedAccess: true`.

---

# Part 1 — Core patterns (any WebSocket app)

## Pattern 1 — Message contract as discriminated union

All control-plane messages, in both directions, live in a single shared module as Zod discriminated unions keyed on a `type` field. (PTY I/O bytes don't go here — see Part 2.)

```ts
// shared/messages.ts
import { z } from "zod";

export const ClientMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session:start"),
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000),
    shell: z.string().max(256).optional(),
    cwd: z.string().max(4096).optional(),
    env: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal("session:resize"),
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000),
  }),
  z.object({
    type: z.literal("session:kill"),
    signal: z.enum(["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP"]).default("SIGTERM"),
  }),
  z.object({ type: z.literal("ping") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;
export type ClientMessageOf<T extends ClientMessage["type"]> = Extract<ClientMessage, { type: T }>;

export const ServerMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session:started"),
    pid: z.number().int(),
    cols: z.number().int(),
    rows: z.number().int(),
  }),
  z.object({
    type: z.literal("session:exit"),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.enum([
      "INVALID_MESSAGE",
      "UNAUTHORIZED",
      "SESSION_LIMIT",
      "SPAWN_FAILED",
      "SESSION_NOT_FOUND",   // used by session:attach
      "SESSION_BUSY",        // used by session:attach
    ]),
    message: z.string(),
  }),
  z.object({ type: z.literal("pong") }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
```

**Rules:**
- Name messages `<domain>:<verb>` (`session:start`, `session:resize`). Flat strings.
- Both directions in the same file. The wire format is one contract.
- Constrain every field with `min`/`max`. Untrusted input — `cols: 100000` should not crash your PTY.
- Never use `z.any()`. Use `z.unknown()` and validate at the next layer.

## Pattern 2 — Parse + validate in one step

Don't `JSON.parse()` in a separate try/catch before validating. Let Zod handle both:

```ts
// shared/messages.ts
export const RawClientMessage = z
  .string()
  .transform((str, ctx) => {
    try {
      return JSON.parse(str);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid JSON" });
      return z.NEVER;
    }
  })
  .pipe(ClientMessage);
```

One `safeParse`, one error path. Apply the same on the client for `RawServerMessage`.

## Pattern 3 — Typed send helpers

In Hono, the WebSocket abstraction is `WSContext`. Its `.send()` returns `void`, so for backpressure-aware sends drop to `ws.raw` (the underlying Bun `ServerWebSocket`).

```ts
import type { WSContext } from "hono/ws";
import type { ServerWebSocket } from "bun";

// Rate-limited logger — backpressure events come in floods, don't drown the log.
const sample = sampleLogger({ every: 1000, windowMs: 5_000 });

/**
 * Send a control message. Returns the Bun send status so callers can react.
 *   -1 = queued (backpressure)
 *    0 = dropped (socket closed or over backpressureLimit)
 *   >0 = bytes sent
 */
function send(ws: WSContext, msg: ServerMessage): number {
  const raw = ws.raw as ServerWebSocket<unknown> | undefined;
  if (!raw) return 0;
  const result = raw.send(JSON.stringify(msg));
  if (result === 0) sample.warn("[ws] control message dropped (closed)");
  if (result === -1) sample.warn("[ws] control channel backpressured");
  return result;
}

function sendBinary(ws: WSContext, bytes: Uint8Array): number {
  const raw = ws.raw as ServerWebSocket<unknown> | undefined;
  return raw?.send(bytes) ?? 0;
}

// Minimal sampling logger — log first event in window, then every Nth, then summarize.
function sampleLogger({ every, windowMs }: { every: number; windowMs: number }) {
  let count = 0;
  let windowStart = 0;
  return {
    warn(msg: string) {
      const now = Date.now();
      if (now - windowStart > windowMs) {
        if (count > 1) console.warn(`[sampled] suppressed ${count - 1} similar events`);
        windowStart = now;
        count = 0;
      }
      if (count === 0 || count % every === 0) console.warn(msg);
      count++;
    },
  };
}
```

If you only need to send control messages and don't care about backpressure status, you can keep the helper simple and call `ws.send(...)` (the `WSContext` method) inside it instead of dropping to `ws.raw`. The point of the helper is the typed `msg` parameter, not the cast — wrap it either way, but always call the helper from outside.

For broadcasting, use Bun's native pub/sub via `ws.raw`:
```ts
(ws.raw as ServerWebSocket<unknown>).subscribe(`room:${roomId}`);
// And from outside a handler, via the Bun.serve return value:
// server.publish(`room:${roomId}`, JSON.stringify(msg));
```

## Pattern 4 — Exhaustive dispatch with `never`

Single `switch` on `type`, `never` default fails the build on missing cases.

```ts
function handleControl(state: SessionState, ws: WSContext, msg: ClientMessage): void {
  switch (msg.type) {
    case "session:start":  return startSession(state, ws, msg);
    case "session:resize": return resizeSession(state, msg);
    case "session:kill":   return killSession(state, msg);
    case "ping":           return send(ws, { type: "pong" });
    default: {
      const _exhaustive: never = msg;
      throw new Error(`Unhandled: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
```

**Do not** dispatch via an object map (`{ "session:start": handler, ... }`) — it loses exhaustiveness.

Wrap dispatch in try/catch, but **distinguish typed errors** so auth escapes don't masquerade as bad input. Define error classes once, branch on them in a shared handler:

```ts
// server/errors.ts
export class UnauthorizedError extends Error { readonly _tag = "UnauthorizedError" as const; }
export class SpawnFailedError extends Error { readonly _tag = "SpawnFailedError" as const; }
export class SessionLimitError extends Error { readonly _tag = "SessionLimitError" as const; }
export class SessionNotFoundError extends Error { readonly _tag = "SessionNotFoundError" as const; }
export class SessionBusyError extends Error { readonly _tag = "SessionBusyError" as const; }

// server/ws.ts — one handler, used by every dispatch site.
export function handleDispatchError(ws: WSContext, err: unknown): void {
  if (err instanceof UnauthorizedError) {
    return void send(ws, { type: "error", code: "UNAUTHORIZED", message: err.message });
  }
  if (err instanceof SpawnFailedError) {
    return void send(ws, { type: "error", code: "SPAWN_FAILED", message: err.message });
  }
  if (err instanceof SessionLimitError) {
    return void send(ws, { type: "error", code: "SESSION_LIMIT", message: err.message });
  }
  if (err instanceof SessionNotFoundError) {
    return void send(ws, { type: "error", code: "SESSION_NOT_FOUND", message: err.message });
  }
  if (err instanceof SessionBusyError) {
    return void send(ws, { type: "error", code: "SESSION_BUSY", message: err.message });
  }
  // Unknown — log internally, give the client a generic error. Never leak err.message.
  console.error("handler error:", err);
  send(ws, { type: "error", code: "INVALID_MESSAGE", message: "Internal error" });
}

// At every dispatch site:
try {
  handleControl(state, ws, result.data);
} catch (err) {
  handleDispatchError(ws, err);
}
```

`validateCwd` and the shell/env whitelist throw `UnauthorizedError`. `startSession` throws `SpawnFailedError` or `SessionLimitError`. `attachSession` throws `SessionNotFoundError` or `SessionBusyError`. The dispatch site stays a one-liner; error semantics live in the throwers.

## Pattern 5 — Heartbeat

Bun handles WS-protocol pings automatically (`sendPings: true` default). You still want an **application-level** ping because the browser WebSocket API can't send protocol pings:

```ts
// Client
const PING_INTERVAL_MS = 25_000;
setInterval(() => client.send({ type: "ping" }), PING_INTERVAL_MS);
// Server responds with { type: "pong" }
```

**Budget the idle timeout to at least 3× the ping interval.** With 25s pings, one packet loss or a brief tab-throttle puts you at ~30–40s of silence. An `idleTimeout: 60` gives you almost no margin — a single missed ping kills the connection. Use **90s** as the floor:

```ts
// Bun.serve config — see "Wiring it together"
idleTimeout: 90,   // ≥ 3 × PING_INTERVAL_MS / 1000
```

Bun's actual default is 120s; the examples below pin it explicitly to make the budget visible.

## Pattern 6 — Reconnection with jittered exponential backoff

```ts
private readonly MAX_RECONNECT_ATTEMPTS = 10;     // ~10 minutes total elapsed
private readonly MAX_RECONNECT_ELAPSED_MS = 10 * 60_000;
private reconnectStartedAt = 0;

private scheduleReconnect(): void {
  if (this.reconnectAttempt === 0) this.reconnectStartedAt = Date.now();

  const elapsed = Date.now() - this.reconnectStartedAt;
  if (
    this.reconnectAttempt >= this.MAX_RECONNECT_ATTEMPTS ||
    elapsed >= this.MAX_RECONNECT_ELAPSED_MS
  ) {
    this.onGiveUp?.("Server unreachable");
    return; // Surface to the user; do not silently keep retrying.
  }

  const base = Math.min(30_000, 1000 * 2 ** this.reconnectAttempt);
  const jitter = Math.random() * 1000;
  setTimeout(() => this.open(), base + jitter);
  this.reconnectAttempt++;
}
```

**Rules:**
- Cap delay at 30s and cap total attempts (or total elapsed time). Unbounded retry hides outages from the user and burns battery.
- Add jitter — without it, every client reconnects in lockstep after a restart.
- Reset `reconnectAttempt = 0` and `reconnectStartedAt = 0` in `onopen`.
- Do **not** reconnect on close codes 1000 (normal), 1001 (going away), or your app-defined 4xxx auth-failure codes (RFC 6455 reserves 4000–4999 for app use; the meanings are yours to pick — `4401` for unauthorized is a sensible convention).
- Expose an `onGiveUp` callback so the UI can show "Reconnect" or "Refresh page" rather than spin forever.
- For PTY apps, consider **not** auto-reconnecting at all — the PTY is orphaned server-side. See PTY Pattern 8 (Session reattach).

## Pattern 7 — Outbound queue (control plane only)

`client.send()` for control messages should work whether connected or not — queue while closed, flush on open. **Never queue PTY stdin** — replaying stale keystrokes after reconnect is dangerous (you might re-confirm a `rm -rf` prompt).

Split the two paths explicitly:

```ts
private static readonly MAX_QUEUE = 256;
private queue: ClientMessage[] = [];

/** Control plane — queues when disconnected, flushes on reconnect. */
sendControl(msg: ClientMessage): void {
  if (this.ws?.readyState === WebSocket.OPEN) {
    this.ws.send(JSON.stringify(msg));
  } else {
    if (this.queue.length >= Client.MAX_QUEUE) this.queue.shift(); // drop oldest
    this.queue.push(msg);
  }
}

/** Stdin — drops when disconnected. Never queue keystrokes. */
sendStdin(bytes: Uint8Array): void {
  if (this.ws?.readyState !== WebSocket.OPEN) return; // drop silently
  this.ws.send(bytes);
}

// In onopen, flush only the control queue:
private flushQueue(): void {
  while (this.queue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
    this.ws.send(JSON.stringify(this.queue.shift()!));
  }
}
```

256 messages is a reasonable cap for most apps — large enough to ride out a 30s network blip of normal control traffic, small enough that a bug spamming `session:resize` can't OOM the tab. Adjust to your traffic profile.

## Pattern 8 — Listener API on the client

```ts
on(listener: (msg: ServerMessage) => void): () => void {
  this.listeners.add(listener);
  return () => this.listeners.delete(listener);
}
```

Returns an unsubscribe function — natural fit with `useEffect`, Vue lifecycle, Svelte `onDestroy`.

---

# Part 2 — PTY-specific patterns

A PTY connection has **two channels muxed over one WebSocket**:
- **Control plane** — start/resize/kill, errors, exit events. Low frequency, structured. JSON text frames, schema-validated.
- **Data plane** — stdin bytes one way, stdout/stderr bytes the other. High frequency, opaque. **Binary frames, no encoding, no validation.**

Encoding raw PTY bytes as JSON-with-base64 is a common mistake — it doubles payload size, burns CPU, and breaks if you cut multi-byte UTF-8 across chunks. Use WebSocket's native binary frames.

## PTY Pattern 1 — Hybrid framing on a Hono route

Per-connection state lives in the closure of the `upgradeWebSocket` callback. No need for `ws.data` keyed lookups.

```ts
// server/ws.ts
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { spawn, type IPty } from "bun-pty"; // or @lydell/node-pty, or node-pty
import type { ServerWebSocket } from "bun";
import { RawClientMessage, type ClientMessage, type ServerMessage } from "../shared/messages";

const wsApp = new Hono();

wsApp.get(
  "/ws",
  // Auth happens here. If c.get("userId") is missing, refuse the upgrade.
  authMiddleware,
  upgradeWebSocket((c) => {
    const userId = c.get("userId") as string;

    // Per-connection state in the closure — typed, no `data` plumbing.
    let pty: IPty | null = null;

    return {
      onOpen(_event, _ws) {
        // Nothing to do until session:start.
      },

      onMessage(event, ws) {
        const raw = ws.raw as ServerWebSocket<unknown>;

        // Binary frame = PTY stdin. Forward straight through.
        if (event.data instanceof ArrayBuffer) {
          pty?.write(Buffer.from(event.data).toString("utf8"));
          return;
        }
        if (event.data instanceof Uint8Array) {
          pty?.write(Buffer.from(event.data).toString("utf8"));
          return;
        }

        // Text frame = control message.
        const result = RawClientMessage.safeParse(event.data);
        if (!result.success) {
          return send(ws, {
            type: "error",
            code: "INVALID_MESSAGE",
            message: result.error.issues[0]?.message ?? "Invalid",
          });
        }

        try {
          handleControl({ userId, getPty: () => pty, setPty: (p) => (pty = p) }, ws, result.data);
        } catch (err) {
          handleDispatchError(ws, err); // typed-error handler from Pattern 4
        }
      },

      onClose(_event, _ws) {
        // PTY without a websocket is a runaway shell. Kill it.
        pty?.kill("SIGHUP");
        pty = null;
      },

      onError(err) {
        console.error("[ws] error:", err);
      },
    };
  }),
);

export default wsApp;
```

Note the `IPty` here uses `.write(string)` — most node-pty-compatible libraries accept strings only for stdin. If you need raw bytes (which you'll see from the binary frame as `Uint8Array`/`ArrayBuffer`), decode them as UTF-8 before writing.

## PTY Pattern 2 — PTY lifecycle (library-agnostic)

```ts
// server/session.ts
import path from "node:path";
import { spawn, type IPty } from "bun-pty";
import type { WSContext } from "hono/ws";
import type { ServerWebSocket } from "bun";
import {
  UnauthorizedError, SpawnFailedError, SessionLimitError,
} from "./errors";

const ALLOWED_SHELLS = ["/bin/bash", "/bin/zsh", "/bin/sh"];
const SAFE_ENV_KEYS = new Set(["LANG", "LC_ALL", "TERM_PROGRAM"]);

/**
 * Minimal safe environment for a shell. We do NOT inherit process.env —
 * that would leak server-side secrets (DATABASE_URL, API keys, etc.) into
 * the user's shell. Build it explicitly.
 */
function buildBaseEnv(userId: string): Record<string, string> {
  return {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: `/var/sessions/${userId}`,
    USER: userId,
    LOGNAME: userId,
    SHELL: "/bin/bash",
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
    TERM: "xterm-256color",
  };
}

type Ctx = {
  userId: string;
  getPty: () => IPty | null;
  setPty: (p: IPty | null) => void;
};

export function startSession(
  ctx: Ctx,
  ws: WSContext,
  msg: ClientMessageOf<"session:start">,
): void {
  if (ctx.getPty()) {
    throw new SessionLimitError("Session already active");
  }

  // Whitelist shell — never let the client pick arbitrary executables.
  if (msg.shell && !ALLOWED_SHELLS.includes(msg.shell)) {
    throw new UnauthorizedError(`Shell not allowed: ${msg.shell}`);
  }
  const shell = msg.shell ?? "/bin/bash";

  // validateCwd throws UnauthorizedError on escape; let it propagate.
  const cwd = validateCwd(msg.cwd, ctx.userId);
  const env = { ...buildBaseEnv(ctx.userId), ...sanitizeEnv(msg.env) };

  let pty: IPty;
  try {
    pty = spawn(shell, [], {
      name: "xterm-256color",
      cols: msg.cols,
      rows: msg.rows,
      cwd,
      env,
    });
  } catch (err) {
    throw new SpawnFailedError(err instanceof Error ? err.message : "spawn failed");
  }

  ctx.setPty(pty);

  // PTY output -> raw binary frame. Handle ALL three send() outcomes.
  const raw = ws.raw as ServerWebSocket<unknown>;
  const bpLog = sampleLogger({ every: 1000, windowMs: 5_000 });

  pty.onData((data: string) => {  // node-pty contract: string (UTF-8)
    const bytes = Buffer.from(data, "utf8");
    const result = raw.send(bytes);

    if (result > 0) return;

    if (result === 0) {
      // Dropped — the socket is closed or over backpressureLimit. The PTY
      // is now writing into the void. Kill it so we don't leak the process.
      bpLog.warn(`[pty ${pty.pid}] send dropped — killing PTY`);
      pty.kill("SIGHUP");
      ctx.setPty(null);
      return;
    }

    // result === -1 — queued (backpressure). Bun will deliver on drain.
    // node-pty has no real pause; rely on backpressureLimit to bound buffering.
    bpLog.warn(`[pty ${pty.pid}] backpressure (buffered=${raw.bufferedAmount})`);
  });

  pty.onExit(({ exitCode, signal }) => {
    send(ws, {
      type: "session:exit",
      exitCode: exitCode ?? null,
      signal: signal ? String(signal) : null,
    });
    ctx.setPty(null);
  });

  send(ws, { type: "session:started", pid: pty.pid, cols: msg.cols, rows: msg.rows });
}

export function resizeSession(ctx: Ctx, msg: ClientMessageOf<"session:resize">): void {
  ctx.getPty()?.resize(msg.cols, msg.rows);
}

export function killSession(ctx: Ctx, msg: ClientMessageOf<"session:kill">): void {
  ctx.getPty()?.kill(msg.signal);
}

function sanitizeEnv(env: Record<string, string> | undefined): Record<string, string> {
  if (!env) return {};
  return Object.fromEntries(Object.entries(env).filter(([k]) => SAFE_ENV_KEYS.has(k)));
}

function validateCwd(cwd: string | undefined, userId: string): string {
  const root = `/var/sessions/${userId}`;
  if (!cwd) return root;
  const resolved = path.resolve(root, cwd);
  if (!resolved.startsWith(root + path.sep)) {
    throw new UnauthorizedError(`cwd escapes user root: ${cwd}`);
  }
  return resolved;
}
```

Three things to call out from this code:

- **`pty.onData` payload is a `string`**, not bytes. That's the node-pty contract across implementations. Buffer-encode it once for the binary frame and don't `.toString()` it again downstream — that's how multi-byte UTF-8 boundaries get corrupted.
- **All three `send()` outcomes are handled.** `-1` is logged; `0` kills the PTY immediately (writing into a closed socket is a process leak); `>0` is the happy path.
- **All error paths throw typed errors.** The dispatch try/catch in Pattern 4 converts them to the right `error.code`. `validateCwd` throwing `UnauthorizedError` does not get masked as `INVALID_MESSAGE`.

## PTY Pattern 3 — Wiring it together

`hono/bun` exports `upgradeWebSocket` for routes and `websocket` for the Bun config. Pass both to `Bun.serve`:

```ts
// server/index.ts
import { Hono } from "hono";
import { websocket } from "hono/bun";
import wsApp from "./ws";
import apiApp from "./api";

const app = new Hono();
app.route("/api", apiApp);
app.route("/", wsApp);

Bun.serve({
  port: 8080,
  fetch: app.fetch,
  websocket, // Hono's BunWebSocketHandler — wires upgradeWebSocket routes to Bun's WS

  // Bun-level WS knobs apply here (Hono passes through):
  // (most of these go inside the `websocket` object in raw Bun.serve; with Hono
  // you set them by merging into `websocket` before passing, or fork the handler.)
});
```

For control over `idleTimeout`, `backpressureLimit`, etc., merge into the Hono-provided `websocket` handler:

```ts
Bun.serve({
  port: 8080,
  fetch: app.fetch,
  websocket: {
    ...websocket,
    idleTimeout: 90,             // ≥ 3× client ping interval (25s)
    maxPayloadLength: 1 * 1024 * 1024,
    backpressureLimit: 16 * 1024 * 1024,
    closeOnBackpressureLimit: false,
    perMessageDeflate: false,    // off for PTY data
    sendPings: true,
  },
});
```

## PTY Pattern 4 — Client (wterm + ghostty)

Apply the same typed-send discipline on the client. `sendControl()` for schema-typed JSON, `sendStdin()` for raw bytes. No inline `ws.send(JSON.stringify(...))`.

```ts
import { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import "@wterm/dom/css";
import { RawServerMessage, type ClientMessage } from "../shared/messages";

const core = await GhosttyCore.load();
const term = new WTerm(document.getElementById("terminal")!, {
  core,
  cols: 80,
  rows: 24,
});
await term.init();

const ws = new WebSocket("ws://localhost:8080/ws");
ws.binaryType = "arraybuffer"; // critical — default is Blob, async to read

// ── Typed send helpers (client side of Pattern 3) ──
function sendControl(msg: ClientMessage): void {
  if (ws.readyState !== WebSocket.OPEN) return; // (or queue, per Pattern 7)
  ws.send(JSON.stringify(msg));
}
function sendStdin(bytes: Uint8Array): void {
  if (ws.readyState !== WebSocket.OPEN) return; // drop, never queue stdin
  ws.send(bytes);
}

ws.onmessage = (event) => {
  // ArrayBuffer = PTY stdout. String = control plane.
  if (event.data instanceof ArrayBuffer) {
    term.write(new Uint8Array(event.data));
    return;
  }
  const result = RawServerMessage.safeParse(event.data);
  if (!result.success) return console.warn("[ws] bad server message", event.data);
  handleServerControl(result.data);
};

ws.onopen = () => {
  sendControl({ type: "session:start", cols: term.cols, rows: term.rows });
};

// Terminal -> server (binary stdin)
term.onData = (data) => {
  sendStdin(new TextEncoder().encode(data));
};

// Terminal -> server (resize as control message, debounced)
let resizeTimer: ReturnType<typeof setTimeout> | null = null;
term.onResize = (cols, rows) => {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    sendControl({ type: "session:resize", cols, rows });
  }, 50);
};
```

## PTY Pattern 5 — Initial resize

The PTY's default geometry (typically 80×24) is almost always wrong. The browser knows the actual terminal size; the server doesn't. The client above sends `cols`/`rows` in `session:start`, which is the right move. Also send a fresh resize on `session:started` if the size has changed since (e.g. the user resized the window during the handshake).

## PTY Pattern 6 — Backpressure and flow control

A spammy process (`yes`, `cat largefile`, `find /`) produces output orders of magnitude faster than a browser can consume. Without flow control, `ws.bufferedAmount` grows unbounded and you OOM the server.

`ServerWebSocket.send()` in Bun returns:
- `-1` — queued (backpressure)
- `0` — dropped (closed or over `backpressureLimit`)
- `>0` — bytes sent

`node-pty`-style libraries don't expose a true `.pause()` (some have a `handleFlowControl` XON/XOFF mode, but it's rarely what you want for a web terminal). Practical options:

**Option A — Drop with a high backpressure limit (recommended default)**

For interactive UIs, dropping stdout above ~16 MB of buffered output is acceptable — the human can't read at that rate anyway. Set in `Bun.serve`:
```ts
backpressureLimit: 16 * 1024 * 1024,
closeOnBackpressureLimit: false,
```
Bun drops frames over the limit and keeps the connection. Surface "output truncated" to the UI if you want.

**Option B — App-level ACK flow control**

Server sends a chunk counter every N bytes; client echoes acks; server only emits while unacked bytes are below a window. This is what the xterm.js flow-control docs describe. More work, but no data loss.

For most apps, **option A is correct**. Don't ship without setting `backpressureLimit`.

## PTY Pattern 7 — Authentication and authorization

PTY-over-WS is **remote code execution as a service**. Auth must be:

1. **In a Hono middleware before the upgrade route.** Reject before the upgrade handshake completes:
   ```ts
   async function authMiddleware(c: Context, next: Next) {
     const userId = await authenticate(c.req);
     if (!userId) return c.text("Unauthorized", 401);
     c.set("userId", userId);
     await next();
   }

   wsApp.get("/ws", authMiddleware, upgradeWebSocket(...));
   ```
   Hono will refuse the upgrade if the middleware returns before `next()`.

2. **Authorize the spawn.** Whitelist shells, sanitize env, confine `cwd`. See `startSession` in PTY Pattern 2.

3. **Per-user limits.** Cap concurrent sessions per `userId` with a `Map<userId, count>`. Cap session duration. Cap CPU/memory via cgroups or container.

4. **Cleanup on close.** Kill the process in `onClose`. Don't trust the client to send `session:kill`.

## PTY Pattern 8 — Session detach/reattach (advanced, optional)

If you want tmux-style behavior (close tab, come back, find your session intact), don't tie the PTY's life to the WebSocket. Maintain a `Map<sessionId, PtySession>` outside any one request, persist its scrollback (last N KB of output as a ring buffer), and reconnect via a `session:attach` message with the prior `sessionId`.

The reattach handshake must include **explicit acks, typed failure codes, and atomic ownership transfer** — without these you have a session-hijack vulnerability where any two clients that know a `sessionId` can race to attach.

Schema additions on both directions:

```ts
// Client → Server
z.object({
  type: z.literal("session:attach"),
  sessionId: z.string().uuid(),
}),

// Server → Client
z.object({
  type: z.literal("session:attached"),       // success ack
  sessionId: z.string().uuid(),
  pid: z.number().int(),
  cols: z.number().int(),
  rows: z.number().int(),
  scrollbackBytes: z.number().int(),         // bytes incoming in the next binary frame
}),
// And extend the `error` enum:
//   code: z.enum([..., "SESSION_NOT_FOUND", "SESSION_BUSY"]),
```

Reattach flow:

1. Client connects, sends `session:attach { sessionId }`.
2. Server **atomically claims ownership** — see the lock pattern below. On failure, send `error { code: "SESSION_NOT_FOUND" }` or `error { code: "SESSION_BUSY" }` and close the prior socket only if the new claimant is authorized.
3. Server sends `session:attached { pid, cols, rows, scrollbackBytes }`.
4. Server writes the buffered scrollback as one binary frame.
5. Server reroutes the PTY's `onData` callback to the new socket.

Atomic claim — the critical part:

```ts
type PtySession = {
  sessionId: string;
  userId: string;
  pty: IPty;
  scrollback: RingBuffer;          // bounded, e.g. 256 KB
  attachedWs: WSContext | null;    // exclusive owner; null = detached
  attachLock: boolean;             // simple mutex for the claim
};

const sessions = new Map<string, PtySession>();

export function attachSession(
  ctx: Ctx,
  ws: WSContext,
  msg: ClientMessageOf<"session:attach">,
): void {
  const session = sessions.get(msg.sessionId);
  if (!session) throw new SessionNotFoundError(msg.sessionId);

  // Ownership check first — never reveal that a sessionId exists to another user.
  if (session.userId !== ctx.userId) {
    throw new SessionNotFoundError(msg.sessionId); // deliberately the same error
  }

  // Atomic claim. Without this, two concurrent attach attempts both succeed
  // and the PTY ends up wired to whichever onData callback was registered last.
  if (session.attachLock) {
    throw new SessionBusyError("Another client is attaching");
  }
  session.attachLock = true;
  try {
    // Detach the previous owner cleanly (or reject — your policy).
    const prev = session.attachedWs;
    if (prev && prev.readyState === WSReadyState.OPEN) {
      // Choice: kick the old session (last-attach-wins) or reject the new one.
      // last-attach-wins is the tmux behavior. Send a close code the old client recognizes.
      prev.close(4409, "Replaced by new attach"); // 4409 = "conflict"
    }

    session.attachedWs = ws;

    // Re-point onData onto the new socket. The old closure no longer fires.
    const raw = ws.raw as ServerWebSocket<unknown>;
    session.pty.onData((data: string) => {
      const bytes = Buffer.from(data, "utf8");
      session.scrollback.append(bytes);
      if (session.attachedWs !== ws) return; // we got detached again
      const r = raw.send(bytes);
      if (r === 0) {
        session.attachedWs = null; // socket gone; session keeps running headless
      }
    });

    send(ws, {
      type: "session:attached",
      sessionId: session.sessionId,
      pid: session.pty.pid,
      cols: session.pty.cols,  // if your IPty exposes it; otherwise track separately
      rows: session.pty.rows,
      scrollbackBytes: session.scrollback.size,
    });
    raw.send(session.scrollback.snapshot()); // one binary frame
  } finally {
    session.attachLock = false;
  }
}
```

Notes:
- **`SESSION_NOT_FOUND` for "wrong owner".** Never leak that a session ID exists for a different user — same error, same timing, same response shape.
- **Pick a detach policy.** Last-attach-wins (kick the old socket with code 4409) matches tmux. Reject-new (`SESSION_BUSY`) is safer if a stolen sessionId is a higher concern than UX.
- **Headless survival.** When `attachedWs` is `null`, the session keeps running and writing to the scrollback ring buffer. Reap sessions abandoned for N hours, not for one disconnect.
- **Bound the ring buffer.** 256 KB is a reasonable default — enough to recover a screen of output, small enough not to OOM with thousands of idle sessions.

## PTY Pattern 9 — wterm + @wterm/ghostty specifics

Use the `@wterm/ghostty` core, not the default Zig core, for anything beyond a toy:
- Full VT compliance (Unicode grapheme handling, all SGR attributes, modes).
- Compatibility with the wider Ghostty/libghostty ecosystem.
- Tradeoff: ~400 KB WASM vs ~12 KB for the default — load lazily if startup time matters.

For React, `@wterm/react` exposes `<Terminal core={core} />` and `useTerminal`. For Vue, `@wterm/vue`.

Things to wire up beyond the basics:
- **Focus:** call `term.focus()` when the panel becomes visible.
- **Themes:** apply via class name (`theme-solarized-dark`, `theme-monokai`, `theme-light`) or CSS variables.
- **Cleanup:** call `term.destroy()` on unmount.
- **Don't use the built-in `WebSocketTransport`** from `@wterm/core` for non-trivial apps. It's a passthrough — you need your own transport for control messages, validation, reconnection, and backpressure-aware sending.

---

# Anti-patterns to avoid

| Don't | Do |
|---|---|
| Use `Bun.spawn({ terminal })` or `Bun.Terminal` for production PTY | Use `bun-pty`, `@lydell/node-pty`, or `node-pty` |
| Send PTY bytes as JSON with base64 | Use binary WebSocket frames; route by `event.data instanceof ArrayBuffer` |
| `JSON.parse` + separate `safeParse` | `z.string().transform(...).pipe(schema)` |
| Object-map dispatch | `switch` with `never` default |
| Inline `ws.send(JSON.stringify(...))` anywhere (server **or client**) | Typed `send` / `sendControl` / `sendStdin` helpers |
| Catch-all `error.code: "INVALID_MESSAGE"` | Typed error classes (`UnauthorizedError`, `SpawnFailedError`, …) → matching `error.code` |
| Inherit `process.env` into the spawned shell | Build a minimal `baseEnv` (`PATH`, `HOME`, `USER`, `LANG`, `TERM`, …) |
| Ignore `ws.send() === 0` | `0` means dropped — kill the PTY; the process is writing into a dead socket |
| Unsampled `console.warn` on every backpressure event | Sample/rate-limit logging — backpressure events flood |
| Unbounded reconnect attempts | Cap by attempts AND elapsed time; surface `onGiveUp` to the UI |
| One queue for control + stdin | Two methods: `sendControl()` queues, `sendStdin()` drops |
| `idleTimeout` close to ping interval (`60` vs 25s ping) | `idleTimeout ≥ 3 × ping_interval` (90s minimum) |
| `session:attach` with no ack | `session:attached` success message + typed `SESSION_NOT_FOUND` / `SESSION_BUSY` errors |
| Two attaches racing on the same `sessionId` | Atomic `attachLock` per session + explicit detach policy (kick old vs reject new) |
| Reveal "wrong owner" vs "not found" on attach | Return identical `SESSION_NOT_FOUND` — don't leak session existence |
| Authenticate via post-connect message | Hono middleware before the `upgradeWebSocket` route |
| Accept arbitrary `shell` / `env` / `cwd` from client | Whitelist, sanitize, confine to per-user root |
| Iterate connections to broadcast | `ws.raw.subscribe(topic)` / `server.publish(topic, msg)` |
| `perMessageDeflate: true` for PTY data | `perMessageDeflate: false` — already-dense bytes |
| `binaryType: "blob"` on the client | `binaryType = "arraybuffer"` — sync read, no Promise |
| Use Hono's `ws.send()` without checking backpressure on PTY hot path | Drop to `ws.raw.send()` and inspect the `-1/0/+` return |
| Auto-reconnect + replay stdin queue | Drop stdin while disconnected; reattach by `sessionId` if needed |
| Leave PTY alive after `onClose` (non-reattach) | Kill in `onClose` unless doing explicit detach/reattach |
| Throw in handlers without typed catch | Typed errors → typed `error.code`; unknown → generic `INVALID_MESSAGE` |
| Send one resize per pixel during drag | Debounce resize ~50ms |
| Unbounded queue / scrollback / sessions map | Cap each with constants; reap abandoned sessions |
| Use the built-in `WebSocketTransport` from `@wterm/core` | Build your own transport with control + binary + reconnect |

---

# Checklist when adding a new message type

1. Add the variant to the union in `shared/messages.ts`.
2. Run `bun tsc --noEmit` — `switch (msg.type)` `never` defaults fail until handled.
3. Add the handler case on the server and in the client's listener switch.
4. Decide: control plane (JSON, schema) or data plane (binary, raw)?
5. Test malformed payloads: missing fields, wrong types, oversized strings, invalid JSON.
6. If high-frequency, decide a backpressure strategy (drop, ack, debounce).

# File layout

```
shared/messages.ts   — Zod schemas + types (the contract)
server/index.ts      — Bun.serve + Hono app wiring
server/ws.ts         — upgradeWebSocket route, dispatch
server/session.ts    — PTY spawn/resize/kill, auth helpers
server/auth.ts       — Hono middleware
client/client.ts     — WebSocket transport + reconnect
client/terminal.ts   — wterm setup, ghostty core load
```

Keep `shared/` free of runtime dependencies on Bun or browser globals so both sides can import it.

---

# Quick reference: Hono + Bun WebSocket

```ts
// server/index.ts
import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "hono/bun";

const app = new Hono();

app.get(
  "/ws",
  authMiddleware,
  upgradeWebSocket((c) => {
    const userId = c.get("userId") as string;
    // per-connection state via closure
    let pty: IPty | null = null;

    return {
      onOpen(event, ws)    { /* WSContext */ },
      onMessage(event, ws) { /* event.data: string | ArrayBuffer */ },
      onClose(event, ws)   { /* cleanup */ },
      onError(err)         { /* log */ },
    };
  }),
);

Bun.serve({
  port: 8080,
  fetch: app.fetch,
  websocket: {
    ...websocket,
    idleTimeout: 90,                     // ≥ 3× client ping interval (Pattern 5)
    maxPayloadLength: 1 * 1024 * 1024,
    backpressureLimit: 16 * 1024 * 1024,
    closeOnBackpressureLimit: false,
    perMessageDeflate: false,
    sendPings: true,
  },
});

// WSContext shape:
//   ws.send(string | ArrayBuffer | Uint8Array, { compress }?)  -> void
//   ws.binaryType, ws.readyState, ws.url, ws.protocol
//   ws.close(code?, reason?)
//   ws.raw  // cast to ServerWebSocket<T> for Bun-specific APIs:
//           //   raw.send() returns -1 queued / 0 dropped / >0 bytes
//           //   raw.subscribe(topic) / raw.publish(topic, msg)
//           //   raw.bufferedAmount
```

# Quick reference: node-pty-compatible PTY API (`IPty`)

```ts
import { spawn, type IPty } from "bun-pty"; // or @lydell/node-pty, or node-pty

const pty: IPty = spawn("bash", [], {
  name: "xterm-256color",
  cols: 80,
  rows: 24,
  cwd: "/home/user",
  env: { ...process.env, TERM: "xterm-256color" },
});

pty.pid;                                  // process id
pty.onData((data: string) => { /* */ }); // PTY output (utf-8 string)
pty.onExit(({ exitCode, signal }) => {}); // exit notification
pty.write(data: string);                  // stdin
pty.resize(cols, rows);                   // TIOCSWINSZ
pty.kill(signal?: string);                // default SIGHUP
```

# Quick reference: wterm client API

```ts
import { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import "@wterm/dom/css";

const core = await GhosttyCore.load();
const term = new WTerm(el, { core, cols: 80, rows: 24 });
await term.init();

term.write(data);            // string | Uint8Array — render
term.resize(cols, rows);
term.focus();
term.destroy();

term.onData = (s: string) => { /* user input */ };
term.onResize = (cols, rows) => { /* size changed */ };
term.onTitle = (title) => { /* OSC 0 / OSC 2 */ };
```
