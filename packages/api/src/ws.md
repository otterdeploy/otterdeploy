# WebSocket + PTY Implementation Guide

A guide for implementing typed, validated WebSocket clients and servers, with a dedicated section for PTY (terminal-over-WS) applications.

## Stack

- **Server:** Bun (≥ 1.3.5 for `Bun.Terminal` PTY; ≥ 1.3.14 for Windows ConPTY). `Bun.serve` for HTTP + WS, `Bun.spawn({ terminal })` or `new Bun.Terminal()` for PTY. No `ws`, no `node-pty`.
- **Client:** [wterm](https://github.com/vercel-labs/wterm) (`@wterm/dom`) with [`@wterm/ghostty`](https://github.com/vercel-labs/wterm/tree/main/packages/@wterm/ghostty) core (libghostty compiled to WASM) for full VT compliance. Native browser `WebSocket`.
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
    code: z.enum(["INVALID_MESSAGE", "UNAUTHORIZED", "SESSION_LIMIT", "SPAWN_FAILED"]),
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

One `safeParse`, one error path:

```ts
const result = RawClientMessage.safeParse(rawText);
if (!result.success) {
  return send(ws, {
    type: "error",
    code: "INVALID_MESSAGE",
    message: result.error.issues[0]?.message ?? "Validation failed",
  });
}
handleControl(ws, result.data); // result.data fully typed
```

Mirror on the client for `RawServerMessage`.

## Pattern 3 — Typed send helpers

Wrap `ws.send()` so it only accepts schema-typed messages. Never call `ws.send()` directly outside these helpers.

```ts
import type { ServerWebSocket } from "bun";

function send(ws: ServerWebSocket<ConnData>, msg: ServerMessage): void {
  // Bun's ws.send returns -1 on backpressure, 0 if dropped, positive on bytes sent.
  const result = ws.send(JSON.stringify(msg));
  if (result === 0) console.warn("[ws] message dropped (closed)");
  if (result === -1) console.warn("[ws] backpressure on control channel");
}
```

For broadcasting, use Bun's native pub/sub instead of iterating connections:

```ts
ws.subscribe(`room:${roomId}`);
server.publish(`room:${roomId}`, JSON.stringify(msg));
```

## Pattern 4 — Exhaustive dispatch with `never`

Single `switch` on `type`, `never` default fails the build on missing cases.

```ts
function handleControl(ws: ServerWebSocket<ConnData>, msg: ClientMessage): void {
  switch (msg.type) {
    case "session:start":  return startSession(ws, msg);
    case "session:resize": return resizeSession(ws, msg);
    case "session:kill":   return killSession(ws, msg);
    case "ping":           return send(ws, { type: "pong" });
    default: {
      const _exhaustive: never = msg;
      throw new Error(`Unhandled: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
```

**Do not** dispatch via an object map (`{ "session:start": handler, ... }`) — it loses exhaustiveness.

Wrap dispatch in try/catch so one bad message doesn't kill the connection:

```ts
try {
  handleControl(ws, result.data);
} catch (err) {
  console.error("handler error:", err);
  send(ws, { type: "error", code: "INVALID_MESSAGE", message: "Internal error" });
  // Never include err.message — don't leak internals.
}
```

## Pattern 5 — Heartbeat

Bun handles WS-protocol pings automatically — `sendPings: true` is the default. You still want an **application-level** ping for the browser side (the browser WebSocket API can't send protocol pings):

```ts
// Client
setInterval(() => client.send({ type: "ping" }), 25_000);
// Server responds with { type: "pong" }
```

Configure Bun's idle timeout to match (default 120s):

```ts
Bun.serve({
  websocket: {
    idleTimeout: 60, // seconds; server closes silent connections after this
    sendPings: true, // default; protocol-level keepalive
    // ...
  },
});
```

## Pattern 6 — Reconnection with jittered exponential backoff

```ts
private scheduleReconnect(): void {
  const base = Math.min(30_000, 1000 * 2 ** this.reconnectAttempt);
  const jitter = Math.random() * 1000;
  setTimeout(() => this.open(), base + jitter);
  this.reconnectAttempt++;
}
```

**Rules:**
- Cap at 30s.
- Add jitter — without it, every client reconnects in lockstep after a restart.
- Reset `reconnectAttempt = 0` in `onopen`.
- Do **not** reconnect on close codes 1000 (normal), 1001 (going away), or custom 4xxx auth-failure codes.
- For PTY apps, consider **not** auto-reconnecting at all — the PTY is orphaned server-side. See PTY Pattern 6 (Session reattach).

## Pattern 7 — Outbound queue

`client.send()` should work whether connected or not. Queue while closed, flush on open. **Skip the queue for PTY stdin** — replaying stale keystrokes after reconnect is dangerous (you might re-confirm a `rm -rf` prompt).

```ts
send(msg: ClientMessage): void {
  if (this.ws?.readyState === WebSocket.OPEN) {
    this.ws.send(JSON.stringify(msg));
  } else {
    if (this.queue.length >= MAX_QUEUE) this.queue.shift();
    this.queue.push(msg);
  }
}
```

Bound queue size always. For PTY-style apps, queue control messages but drop keystrokes when disconnected.

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

Encoding raw PTY bytes as JSON-with-base64 is a common mistake — it doubles payload size, burns CPU, and breaks if you cut multi-byte UTF-8 across chunks. Use WebSocket's native binary frames instead.

## PTY Pattern 1 — Hybrid framing (text + binary on one socket)

WebSocket supports text and binary frames natively. Route by frame type:

**Server (Bun):**
```ts
type ConnData = {
  userId: string;
  term: Bun.Terminal | null;
  proc: Bun.Subprocess | null;
  paused: boolean;
};

Bun.serve<ConnData>({
  port: 8080,

  fetch(req, server) {
    const userId = authenticate(req); // see PTY Pattern 5
    if (!userId) return new Response("Unauthorized", { status: 401 });

    const ok = server.upgrade(req, {
      data: { userId, term: null, proc: null, paused: false },
    });
    return ok ? undefined : new Response("Upgrade failed", { status: 400 });
  },

  websocket: {
    idleTimeout: 60,
    maxPayloadLength: 1 * 1024 * 1024,    // stdin is small; cap aggressively
    backpressureLimit: 16 * 1024 * 1024,  // stdout can burst
    closeOnBackpressureLimit: false,      // drop frames instead of closing
    perMessageDeflate: false,             // do NOT compress PTY data

    open(ws) {
      // ws.data is ConnData, typed via the generic on Bun.serve<ConnData>.
    },

    message(ws, message) {
      // Text frame = control plane. Binary frame = PTY stdin.
      if (typeof message === "string") {
        const result = RawClientMessage.safeParse(message);
        if (!result.success) {
          return send(ws, {
            type: "error",
            code: "INVALID_MESSAGE",
            message: result.error.issues[0]?.message ?? "Invalid",
          });
        }
        return handleControl(ws, result.data);
      }
      // Binary: forward straight to PTY stdin. No parsing, no copying.
      ws.data.term?.write(message);
    },

    drain(ws) {
      // Backpressure cleared — resume the PTY producer if we paused it.
      ws.data.paused = false;
    },

    close(ws) {
      // PTY without a websocket is a runaway shell. Kill it.
      ws.data.proc?.kill("SIGHUP");
      ws.data.term?.close();
      ws.data.term = null;
      ws.data.proc = null;
    },
  },
});
```

**Client (wterm):**
```ts
import { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import "@wterm/dom/css";

const core = await GhosttyCore.load();
const term = new WTerm(document.getElementById("terminal")!, {
  core,
  cols: 80,
  rows: 24,
});
await term.init();

const ws = new WebSocket("ws://localhost:8080");
ws.binaryType = "arraybuffer"; // critical — default is Blob, async to read

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

// Terminal -> server (binary stdin)
term.onData = (data) => {
  if (ws.readyState !== WebSocket.OPEN) return; // drop, don't queue
  ws.send(new TextEncoder().encode(data));
};

// Terminal -> server (resize as control message — text frame)
term.onResize = (cols, rows) => {
  ws.send(JSON.stringify({ type: "session:resize", cols, rows }));
};
```

## PTY Pattern 2 — Bun.Terminal lifecycle

Use `Bun.spawn({ terminal: { ... } })` (or the standalone `new Bun.Terminal()`). No `node-pty`. POSIX since v1.3.5, Windows ConPTY since v1.3.14.

```ts
function startSession(ws: ServerWebSocket<ConnData>, msg: ClientMessageOf<"session:start">) {
  if (ws.data.term) {
    return send(ws, {
      type: "error",
      code: "SESSION_LIMIT",
      message: "Session already active",
    });
  }

  // Pin the shell server-side. Never accept arbitrary `shell` from the client.
  const shell = ALLOWED_SHELLS.includes(msg.shell ?? "") ? msg.shell! : "/bin/bash";

  const proc = Bun.spawn([shell], {
    cwd: validateCwd(msg.cwd, ws.data.userId), // see PTY Pattern 5
    env: { ...baseEnv, ...sanitizeEnv(msg.env), TERM: "xterm-256color" },
    terminal: {
      cols: msg.cols,
      rows: msg.rows,
      data(_term, data) {
        // PTY output -> raw binary frame.
        const r = ws.send(data);
        if (r === -1) {
          // Buffer is filling. Mark paused; drain() will clear.
          ws.data.paused = true;
          // (Bun.Terminal has no direct pause(). See PTY Pattern 4.)
        }
      },
    },
    onExit(proc, exitCode, signalCode) {
      send(ws, {
        type: "session:exit",
        exitCode,
        signal: signalCode ? String(signalCode) : null,
      });
      ws.data.term = null;
      ws.data.proc = null;
    },
  });

  ws.data.proc = proc;
  ws.data.term = proc.terminal!;
  send(ws, { type: "session:started", pid: proc.pid, cols: msg.cols, rows: msg.rows });
}

function resizeSession(ws: ServerWebSocket<ConnData>, msg: ClientMessageOf<"session:resize">) {
  ws.data.term?.resize(msg.cols, msg.rows);
}

function killSession(ws: ServerWebSocket<ConnData>, msg: ClientMessageOf<"session:kill">) {
  ws.data.proc?.kill(msg.signal);
}
```

## PTY Pattern 3 — Always send an initial resize

The PTY's default geometry (typically 80×24) is almost always wrong. The browser knows the actual terminal size; the server doesn't. Right after `session:started` the client should push the real size:

```ts
// Client
handleServerControl((msg) => {
  if (msg.type === "session:started") {
    // wterm fires onResize on init; if not, push current size explicitly.
    ws.send(JSON.stringify({ type: "session:resize", cols: term.cols, rows: term.rows }));
  }
});
```

For dynamic UIs, debounce resize to ~50ms — sending one resize per pixel during a window-drag will saturate the channel and the PTY hates rapid `TIOCSWINSZ` calls.

## PTY Pattern 4 — Backpressure and flow control

A spammy process (`yes`, `cat largefile`, `find /`) produces output orders of magnitude faster than a browser can consume. Without flow control, `ws.bufferedAmount` grows unbounded and you OOM the server.

`ws.send()` in Bun returns:
- `-1` — queued (backpressure)
- `0` — dropped (connection closed or over `backpressureLimit`)
- `>0` — bytes sent

When you see `-1`, you want to slow the producer. Bun.Terminal doesn't expose a clean `pause()`, so the practical options are:

**Option A — Drop with a high backpressure limit (recommended default)**

For interactive UIs, dropping stdout above ~16 MB of buffered output is acceptable — the human can't read at that rate anyway. Set:
```ts
backpressureLimit: 16 * 1024 * 1024,
closeOnBackpressureLimit: false,
```
Bun drops frames over the limit and keeps the connection. Set a tracking flag in `drain()` if you want to surface "output truncated" to the UI.

**Option B — App-level ACK flow control**

For correctness-critical apps. Server sends a chunk counter every N bytes; client echoes acks; server only emits while unacked bytes are below a window. This is what the xterm.js flow-control docs describe. More work, but no data loss.

**Option C — `setRawMode(false)` workaround**

Bun.Terminal has `setRawMode()`, `ref()`, and `unref()` but no `pause()`. `unref()` detaches the terminal from the event loop but doesn't stop the kernel-side pipe — not a real solution. If you need true producer pause, use a `Bun.Subprocess` with `stdout: "pipe"` instead of `terminal:` and apply the standard ReadableStream backpressure, at the cost of losing TTY semantics.

For most apps, **option A is the right default**. Don't ship without setting `backpressureLimit`.

## PTY Pattern 5 — Authentication and authorization

PTY-over-WS is **remote code execution as a service**. Auth must be:

1. **At the upgrade**, not in a post-connect message:
   ```ts
   fetch(req, server) {
     const userId = authenticate(req); // cookie, Authorization header, signed URL token
     if (!userId) return new Response("Unauthorized", { status: 401 });
     server.upgrade(req, { data: { userId, /* ... */ } });
   }
   ```
2. **Authorize the spawn.** Never let the client pick arbitrary `shell` or `env`:
   ```ts
   const ALLOWED_SHELLS = ["/bin/bash", "/bin/zsh", "/bin/sh"];
   const SAFE_ENV_KEYS = ["LANG", "LC_ALL", "TERM_PROGRAM"]; // expand cautiously

   function sanitizeEnv(env: Record<string, string> | undefined) {
     if (!env) return {};
     return Object.fromEntries(Object.entries(env).filter(([k]) => SAFE_ENV_KEYS.includes(k)));
   }
   ```
3. **Authorize `cwd`.** Confine to a per-user root:
   ```ts
   function validateCwd(cwd: string | undefined, userId: string): string {
     const root = `/var/sessions/${userId}`;
     if (!cwd) return root;
     const resolved = path.resolve(root, cwd);
     if (!resolved.startsWith(root + path.sep)) throw new Error("cwd escapes root");
     return resolved;
   }
   ```
4. **Per-user limits.** Cap concurrent sessions per `userId`, cap session duration, cap CPU/memory via cgroups or container.
5. **Cleanup on close.** Kill the process in the `close` handler. Don't trust the client to send `session:kill`.

```ts
close(ws) {
  ws.data.proc?.kill("SIGHUP");
  ws.data.term?.close();
}
```

## PTY Pattern 6 — Session detach/reattach (advanced, optional)

If you want tmux-style behavior (close tab, come back, find your session intact), don't tie the PTY's life to the WebSocket. Maintain a `Map<sessionId, PtySession>` on the server, persist its scrollback (last N KB of output as a ring buffer), and reconnect via a `session:attach` message with the prior `sessionId`.

Schema additions:

```ts
z.object({
  type: z.literal("session:attach"),
  sessionId: z.string().uuid(),
}),
z.object({
  type: z.literal("session:scrollback"),
  // Server sends scrollback as a separate binary frame, but the metadata is control:
  bytes: z.number().int(),
}),
```

Reattach flow:
1. Client connects, sends `session:attach { sessionId }`.
2. Server validates ownership (`session.userId === ws.data.userId`).
3. Server sends `session:scrollback { bytes }`, then writes the buffered output as one binary frame.
4. Server reroutes the PTY's `data` callback to the new socket.

Bound the scrollback ring buffer per session (e.g. 256 KB). Reap abandoned sessions after N hours.

## PTY Pattern 7 — wterm + @wterm/ghostty specifics

Use the `@wterm/ghostty` core, not the default Zig core, for anything beyond a toy:
- Full VT compliance (Unicode grapheme handling, all SGR attributes, modes).
- Compatibility with the wider Ghostty/libghostty ecosystem.
- Tradeoff: ~400 KB WASM vs ~12 KB for the default — load lazily if startup time matters.

```ts
import { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import "@wterm/dom/css";

const core = await GhosttyCore.load(); // load WASM once, share across terminals
const term = new WTerm(el, { core, cols: 80, rows: 24 });
await term.init();
```

For React, `@wterm/react` exposes a `<Terminal core={core} />` component and `useTerminal` hook. For Vue, `@wterm/vue` provides the same.

Things to wire up beyond the basics:
- **Focus:** call `term.focus()` when the panel becomes visible.
- **Themes:** apply via class name (`theme-solarized-dark`, `theme-monokai`, `theme-light`) or CSS variables on the container.
- **Cleanup:** call `term.destroy()` on unmount — otherwise dirty-row tracking keeps running and event listeners leak.
- **Don't use the built-in `WebSocketTransport`** from `@wterm/core` for non-trivial apps. It's a thin passthrough — you need your own transport for control messages, validation, reconnection, and backpressure-aware sending.

---

# Anti-patterns to avoid

| Don't | Do |
|---|---|
| Send PTY bytes as JSON with base64 | Use binary WebSocket frames; route by `typeof message === "string"` |
| `JSON.parse` + separate `safeParse` | `z.string().transform(...).pipe(schema)` |
| Object-map dispatch | `switch` with `never` default |
| `ws.send(JSON.stringify(...))` inline | Typed `send(ws, msg)` helper |
| `node-pty` on Bun | Native `Bun.spawn({ terminal })` or `new Bun.Terminal()` |
| Authenticate via post-connect message | Authenticate in the `fetch` handler before `upgrade()` |
| Accept arbitrary `shell` / `env` / `cwd` from client | Whitelist, sanitize, confine to per-user root |
| Iterate connections to broadcast | `ws.subscribe(topic)` / `server.publish(topic, msg)` |
| `perMessageDeflate: true` for PTY data | `perMessageDeflate: false` — PTY output is already dense |
| `binaryType: "blob"` on the client | `binaryType = "arraybuffer"` — sync read, no Promise |
| Auto-reconnect + replay stdin queue | Drop stdin while disconnected; reattach by `sessionId` if needed |
| Leave PTY alive after WS close | Kill in `close` unless doing explicit reattach |
| Ignore `ws.send()` return value | Check for `-1` (backpressure) and `0` (dropped) |
| Throw in handlers without catching | Wrap dispatch in try/catch, send generic `error` |
| Send one resize per pixel during drag | Debounce resize ~50ms |
| Unbounded outbound queue or scrollback | Cap both with constants, drop oldest |
| Use the built-in `WebSocketTransport` from `@wterm/core` | Build your own transport with control + binary + reconnect |

---

# Checklist when adding a new message type

1. Add the variant to the union in `shared/messages.ts`.
2. Run `bun tsc --noEmit` — `switch (msg.type)` `never` defaults fail until handled.
3. Add the handler case on the server (inbound) or in every listener (outbound).
4. Decide: control plane (JSON, schema) or data plane (binary, raw)?
5. Test malformed payloads: missing fields, wrong types, oversized strings, invalid JSON.
6. If it's high-frequency, decide a backpressure strategy (drop, ack, debounce).

# File layout

```
shared/messages.ts   — Zod schemas + types (the contract)
server/server.ts     — Bun.serve, dispatch
server/session.ts    — Bun.Terminal lifecycle, auth helpers
client/client.ts     — WebSocket transport + reconnect
client/terminal.ts   — wterm setup, ghostty core load
```

Keep `shared/` free of runtime dependencies on Bun or browser globals so both sides can import it.

---

# Quick reference: Bun WS server API

```ts
Bun.serve<ConnData>({
  port: 8080,

  fetch(req, server) {
    // Authenticate here. Attach typed per-connection data.
    const ok = server.upgrade(req, { data: { userId: "..." } });
    return ok ? undefined : new Response("Upgrade failed", { status: 400 });
  },

  websocket: {
    // Limits
    maxPayloadLength: 1 * 1024 * 1024,
    backpressureLimit: 16 * 1024 * 1024,
    closeOnBackpressureLimit: false,
    idleTimeout: 60,                  // seconds
    sendPings: true,                  // protocol-level keepalive (default)
    perMessageDeflate: false,         // off for PTY; on for chat is fine

    // Handlers (ws.data is ConnData)
    open(ws)              { /* ... */ },
    message(ws, message)  { /* string for text frames, Buffer/Uint8Array for binary */ },
    drain(ws)             { /* backpressure cleared */ },
    close(ws, code, rsn)  { /* cleanup */ },
    ping(ws, data)        { /* optional */ },
    pong(ws, data)        { /* optional */ },
  },
});

// ws.send returns: -1 queued (backpressure), 0 dropped, >0 bytes sent
// ws.publish(topic, data) / ws.subscribe(topic) / ws.unsubscribe(topic)
// server.publish(topic, data) — broadcast from outside a handler
```

# Quick reference: Bun.Terminal API

```ts
// Spawn-attached
const proc = Bun.spawn(["bash"], {
  cwd, env,
  terminal: {
    cols: 80,
    rows: 24,
    data(term, data) { /* Uint8Array of PTY output */ },
  },
  onExit(proc, exitCode, signalCode, err) { /* ... */ },
});
proc.terminal!.write(data);            // stdin (string or Uint8Array)
proc.terminal!.resize(cols, rows);
proc.terminal!.setRawMode(true);
proc.terminal!.close();
proc.kill("SIGTERM");

// Standalone (reuse across spawns)
await using terminal = new Bun.Terminal({ cols: 80, rows: 24, data: (t, d) => {} });
```

# Quick reference: wterm client API

```ts
import { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import "@wterm/dom/css";

const core = await GhosttyCore.load();
const term = new WTerm(el, { core, cols: 80, rows: 24 });
await term.init();

term.write(data);            // string | Uint8Array — render to terminal
term.resize(cols, rows);
term.focus();
term.destroy();

term.onData = (s: string) => { /* user input */ };
term.onResize = (cols, rows) => { /* size changed */ };
term.onTitle = (title) => { /* OSC 0 / OSC 2 */ };
```
