/**
 * Owns the /pty WebSocket lifecycle for one terminal session: minting a
 * fresh single-use ticket (od-5j8.9) before every connect attempt — initial
 * open AND each reconnect, since a ticket is burned the moment it's used —
 * prompting for step-up re-authentication when the server says there's no
 * live grant, and the usual reconnect-with-backoff + control-frame handling.
 * Split out of the `TerminalSession` component so that component stays
 * render/layout-focused; this hook is the connection state machine.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { env } from "@otterdeploy/env/web";

import { ServerMessage } from "@/messages";

import type { SessionSource } from "../types";

import { mintShellTicket, shellTargetFor, StepUpRequiredError } from "./tickets";

export type ConnState =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "reconnecting"; attempt: number }
  | { kind: "closed"; code?: number; reason?: string }
  | { kind: "error"; message: string };

// Reconnect backoff bounds. Start at 1s and double up to 30s — same curve the
// upstream @wterm/core WebSocketTransport uses, minus the all-binary protocol
// that's incompatible with our text/binary frame discriminator.
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

function wsUrlForTicket(ticket: string): string {
  const base = env.VITE_SERVER_URL.replace(/^http/, "ws");
  return `${base}/pty?ticket=${encodeURIComponent(ticket)}`;
}

function notImplementedMessage(source: SessionSource): string | null {
  const c = (s: string) => `\x1b[33m${s}\x1b[0m`;
  switch (source.kind) {
    case "container":
      return null;
    case "ssh":
      // Local SSH has a real backend — only remote SSH is missing.
      if (source.mode === "local") return null;
      return (
        `\r\n${c(`[ssh backend not implemented]`)}\r\n` +
        `   No connection was opened to ${source.node} (${source.host}).\r\n` +
        `   The server-side SSH exec path isn't wired up yet.\r\n\r\n`
      );
    case "database":
      return (
        `\r\n${c(`[database console not implemented]`)}\r\n` +
        `   No connection was opened to ${source.service} (${source.engine}).\r\n` +
        `   The server-side ${source.engine} console path isn't wired up yet.\r\n\r\n`
      );
  }
}

interface Options {
  write: (data: string | Uint8Array) => void;
  onConnChange?: (conn: ConnState) => void;
}

/**
 * Hold a source steady across renders, keyed on WHAT it identifies rather than
 * the identity of the object carrying it.
 *
 * A caller that builds `source` inline hands back a new object every render.
 * As the connection effect's dependency, that tore the WebSocket down and
 * reopened it on each render — which the UI rendered as an endless
 * "connection lost — reconnecting" while the server was perfectly healthy.
 * Callers should memoize anyway; this makes forgetting harmless instead of
 * fatal. A genuine target change still produces a new key, so switching
 * container or replica reconnects exactly as it should.
 */
function useStableSource(source: SessionSource): SessionSource {
  const key = JSON.stringify(source);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by value, not identity
  return useMemo(() => source, [key]);
}

export function useShellConnection(target: SessionSource, { write, onConnChange }: Options) {
  const wsRef = useRef<WebSocket | null>(null);
  // Flips true on the FIRST byte written from any source (server data, the
  // reconnect-lost banner, the not-implemented notice, …) and never resets —
  // a later reconnect after real output already has scrollback on screen.
  const [hasOutput, setHasOutput] = useState(false);
  const hasOutputRef = useRef(false);

  // od-5j8.9 step-up prompt: set while the connect effect is waiting on the
  // user to confirm a fresh password/TOTP code before a ticket can be
  // minted. The resolver lives in a ref (not state) so the effect's cleanup
  // can reject a still-pending wait without touching render state races.
  const stepUpWaiterRef = useRef<{ resolve: () => void; reject: (err: unknown) => void } | null>(
    null,
  );
  const [stepUpPromptOpen, setStepUpPromptOpen] = useState(false);

  // Pinned in refs so the connect effect doesn't re-run on every parent
  // render — re-running would tear down and reopen the WebSocket, which is
  // what makes two sessions to the same host clobber each other.
  const writeRef = useRef(write);
  useEffect(() => {
    writeRef.current = write;
  }, [write]);
  const onConnChangeRef = useRef(onConnChange);
  useEffect(() => {
    onConnChangeRef.current = onConnChange;
  }, [onConnChange]);

  const writeVisible = (data: string | Uint8Array) => {
    writeRef.current(data);
    if (!hasOutputRef.current) {
      hasOutputRef.current = true;
      setHasOutput(true);
    }
  };

  const source = useStableSource(target);

  useEffect(() => {
    const target = shellTargetFor(source);
    if (!target) {
      const msg = notImplementedMessage(source);
      if (msg) writeVisible(msg);
      onConnChangeRef.current?.({
        kind: "error",
        message: `${source.kind} backend not implemented`,
      });
      return;
    }

    // `disposed` guards against the effect cleanup racing a pending reconnect
    // (or a pending ticket mint / step-up prompt): once we tear down we must
    // never open a socket.
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = RECONNECT_BASE_MS;
    let attempt = 0;

    const update = (next: ConnState) => onConnChangeRef.current?.(next);

    // Mint a ticket right before every connect attempt — a dropped
    // connection needs a fresh one, the old one is single-use even on
    // success. `STEP_UP_REQUIRED` means there's no live re-auth grant;
    // prompt for one and retry exactly once.
    const getTicket = async (): Promise<string> => {
      try {
        return (await mintShellTicket(target)).ticket;
      } catch (err) {
        if (!(err instanceof StepUpRequiredError)) throw err;
        await new Promise<void>((resolve, reject) => {
          stepUpWaiterRef.current = { resolve, reject };
          setStepUpPromptOpen(true);
        });
        return (await mintShellTicket(target)).ticket;
      }
    };

    const handleMessage = (e: MessageEvent) => {
      if (e.data instanceof ArrayBuffer) {
        writeVisible(new Uint8Array(e.data));
        return;
      }
      if (typeof e.data !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(e.data);
      } catch {
        return;
      }
      const result = ServerMessage.safeParse(parsed);
      if (!result.success) return;
      const msg = result.data;
      switch (msg.type) {
        case "session:exit": {
          const detail =
            msg.exitCode != null
              ? ` with code ${msg.exitCode}`
              : msg.signal
                ? ` (${msg.signal})`
                : "";
          writeVisible(`\r\n[process exited${detail}]\r\n`);
          return;
        }
        case "error":
          update({ kind: "error", message: `[${msg.code}] ${msg.message}` });
          writeVisible(`\r\n[${msg.code}] ${msg.message}\r\n`);
          return;
        default: {
          const _exhaustive: never = msg;
          return _exhaustive;
        }
      }
    };

    const connect = async () => {
      let ticket: string;
      try {
        ticket = await getTicket();
      } catch (err) {
        if (disposed) return;
        const message = err instanceof Error ? err.message : "Couldn't open a shell.";
        update({ kind: "error", message });
        writeVisible(`\r\n\x1b[31m[${message}]\x1b[0m\r\n`);
        // No auto-reconnect — retrying immediately would just re-prompt for
        // step-up (or re-hit the same authorization denial) in a loop. The
        // caller can retry by opening a new session.
        return;
      }
      if (disposed) return;

      const ws = new WebSocket(wsUrlForTicket(ticket));
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        reconnectDelay = RECONNECT_BASE_MS;
        attempt = 0;
        update({ kind: "connected" });
      };
      ws.onerror = () => update({ kind: "error", message: "WebSocket error" });
      ws.onclose = (e) => {
        if (disposed) return;
        // Code 1000 is a deliberate server-side end (the shell exited) —
        // leave it closed. Any other code is an abnormal drop, so reconnect
        // with exponential backoff. The server spawns a fresh shell per
        // connection, so this starts a new session rather than resuming.
        if (e.code === 1000) {
          update({ kind: "closed", code: e.code, reason: e.reason });
          return;
        }
        attempt += 1;
        update({ kind: "reconnecting", attempt });
        writeVisible(
          `\r\n\x1b[33m[connection lost — reconnecting in ${Math.round(reconnectDelay / 1000)}s…]\x1b[0m\r\n`,
        );
        reconnectTimer = setTimeout(() => void connect(), reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
      };
      ws.onmessage = handleMessage;
    };

    update({ kind: "connecting" });
    void connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      // Cancel a step-up prompt this instance is waiting on — never let a
      // stale waiter resolve into a socket open after the effect tore down.
      stepUpWaiterRef.current?.reject(new Error("disposed"));
      stepUpWaiterRef.current = null;
      setStepUpPromptOpen(false);
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- writeVisible/update read through refs on purpose
  }, [source]);

  const resolveStepUp = () => {
    setStepUpPromptOpen(false);
    stepUpWaiterRef.current?.resolve();
    stepUpWaiterRef.current = null;
  };
  const cancelStepUp = (reason: unknown) => {
    setStepUpPromptOpen(false);
    stepUpWaiterRef.current?.reject(reason);
    stepUpWaiterRef.current = null;
  };

  return { wsRef, hasOutput, stepUpPromptOpen, resolveStepUp, cancelStepUp };
}
