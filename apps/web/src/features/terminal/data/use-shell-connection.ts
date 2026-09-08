/**
 * Owns the /pty WebSocket lifecycle for one terminal session: minting a
 * fresh single-use ticket (od-5j8.9) before every connect attempt. Initial
 * open AND each reconnect, since a ticket is burned the moment it's used.
 * Prompting for step-up re-authentication when the server says there's no
 * live grant, and the usual reconnect-with-backoff + control-frame handling.
 * Split out of the `TerminalSession` component so that component stays
 * render/layout-focused; this hook is the connection state machine.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { env } from "@otterdeploy/env/web";
import { Result } from "better-result";

import { ServerMessage } from "@/messages";

import type { SessionSource } from "../types";

import { type ShellTarget, mintShellTicket, shellTargetFor, StepUpRequiredError } from "./tickets";

export type ConnState =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "reconnecting"; attempt: number }
  | { kind: "closed"; code?: number; reason?: string }
  | { kind: "error"; message: string };

// Reconnect backoff bounds. Start at 1s and double up to 30s. Same curve the
// upstream @wterm/core WebSocketTransport uses, minus the all-binary protocol
// that's incompatible with our text/binary frame discriminator.
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
/** How long a socket may sit neither open nor errored before we call it.
 *  Generous: a slow control plane behind a cold proxy is not a failure, and a
 *  premature timeout on a shell that would have worked is worse than a few
 *  extra seconds of spinner. */
const OPEN_TIMEOUT_MS = 20_000;

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
      // Local SSH has a real backend. Only remote SSH is missing.
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
 * reopened it on each render, which the UI rendered as an endless
 * "connection lost, reconnecting" while the server was perfectly healthy.
 * Callers should memoize anyway; this makes forgetting harmless instead of
 * fatal. A genuine target change still produces a new key, so switching
 * container or replica reconnects exactly as it should.
 */
function useStableSource(source: SessionSource): SessionSource {
  const key = JSON.stringify(source);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by value, not identity
  return useMemo(() => source, [key]);
}

/**
 * The socket's message handler.
 *
 * Extracted from the hook only to keep it under the function-size cap; the
 * behaviour is unchanged and the closure it needs is passed in rather than
 * captured.
 */
function makeMessageHandler(deps: {
  writeVisible: (data: Uint8Array | string) => void;
  update: (next: ConnState) => void;
}): (e: MessageEvent) => void {
  const { writeVisible, update } = deps;
  return (e: MessageEvent) => {
    if (e.data instanceof ArrayBuffer) {
      writeVisible(new Uint8Array(e.data));
      return;
    }
    // Everything that can reject a frame lives in one place: a non-string
    // payload, unparseable JSON, and JSON that isn't a ServerMessage all
    // come back as null. A peer can put anything on this socket, so none of
    // those is exceptional. They just mean "ignore this frame".
    const decoded = Result.try({
      try: () => {
        if (typeof e.data !== "string") return null;
        const parsed = ServerMessage.safeParse(JSON.parse(e.data));
        return parsed.success ? parsed.data : null;
      },
      catch: () => null,
    });
    if (decoded.isErr() || !decoded.value) return;
    const msg = decoded.value;
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
}

/**
 * Mint a ticket, prompting for step-up once if the grant has lapsed.
 *
 * `promptForStepUp` resolves when the operator completes the dialog and
 * rejects on teardown, so the wait is unbounded on purpose: a human is typing
 * a password, and nothing here may hurry them.
 */
async function mintTicketWithStepUp(
  target: ShellTarget,
  promptForStepUp: () => Promise<void>,
): Promise<string> {
  const first = await Result.tryPromise({
    try: () => mintShellTicket(target),
    catch: (cause) => cause,
  });
  if (first.isOk()) return first.value.ticket;
  // A missing step-up grant is the ONE recoverable failure here. Anything else
  // (denied authorization, a dead network) is the caller's to report, so it
  // propagates rather than being retried behind a prompt.
  if (!(first.error instanceof StepUpRequiredError)) throw first.error;
  await promptForStepUp();
  // Retried exactly once: a second STEP_UP_REQUIRED means the grant did not
  // take, and prompting again would loop.
  return (await mintShellTicket(target)).ticket;
}

/**
 * Fail a socket that neither opens nor errors, and say what did not happen.
 *
 * Without this the session sits on "Connecting…" forever, which is the one
 * outcome an operator can do nothing with: no reason, no failure, no end. The
 * report that prompted it asked for exactly this and nothing more — "it should
 * at minimum time out with a reason" (od-nkpx).
 *
 * Deliberately covers ONLY the socket open, not the ticket mint before it.
 * Everything before this point may legitimately take as long as it likes,
 * because the step-up dialog is waiting on a human typing a password; timing
 * that out would cancel the very prompt it exists to rescue.
 *
 * Returns the canceller, which every terminal handler calls.
 */
function boundSocketOpen(
  ws: WebSocket,
  hooks: { isDisposed: () => boolean; onTimeout: (message: string, line: string) => void },
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timer = null;
    if (hooks.isDisposed() || ws.readyState === WebSocket.OPEN) return;
    hooks.onTimeout(
      "Timed out opening the shell",
      `\r\n\x1b[31m[timed out after ${Math.round(OPEN_TIMEOUT_MS / 1000)}s opening the shell. ` +
        `The ticket was issued, so this is the connection itself: check that the control plane is ` +
        `reachable and that nothing is blocking the websocket upgrade.]\x1b[0m\r\n`,
    );
    // Closed explicitly: a socket left hanging would fire `onclose` later and
    // start the reconnect loop behind an error already shown to the operator.
    ws.close();
  }, OPEN_TIMEOUT_MS);

  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}

export function useShellConnection(target: SessionSource, { write, onConnChange }: Options) {
  const wsRef = useRef<WebSocket | null>(null);
  // Flips true on the FIRST byte written from any source (server data, the
  // reconnect-lost banner, the not-implemented notice, …) and never resets:
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
  // render. Re-running would tear down and reopen the WebSocket, which is
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

    // Mint a ticket right before every connect attempt: a dropped
    // connection needs a fresh one, the old one is single-use even on
    // success. `STEP_UP_REQUIRED` means there's no live re-auth grant;
    // prompt for one and retry exactly once.
    const getTicket = () =>
      mintTicketWithStepUp(
        target,
        () =>
          // Rejects on teardown (see the cleanup), which surfaces to the caller
          // as an error it discards because `disposed` is already set.
          new Promise<void>((resolve, reject) => {
            stepUpWaiterRef.current = { resolve, reject };
            setStepUpPromptOpen(true);
          }),
      );

    const handleMessage = makeMessageHandler({ writeVisible, update });

    const connect = async () => {
      const ticket = await Result.tryPromise({
        try: () => getTicket(),
        catch: (cause) => (cause instanceof Error ? cause.message : "Couldn't open a shell."),
      });
      // Checked before the outcome is read: a teardown mid-mint must stay
      // silent whether the mint succeeded or failed.
      if (disposed) return;
      if (ticket.isErr()) {
        update({ kind: "error", message: ticket.error });
        writeVisible(`\r\n\x1b[31m[${ticket.error}]\x1b[0m\r\n`);
        // No auto-reconnect, retrying immediately would just re-prompt for
        // step-up (or re-hit the same authorization denial) in a loop. The
        // caller can retry by opening a new session.
        return;
      }

      const ws = new WebSocket(wsUrlForTicket(ticket.value));
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";

      // Bound the open: see `boundSocketOpen`.
      const clearOpenTimer = boundSocketOpen(ws, {
        isDisposed: () => disposed,
        onTimeout: (message, line) => {
          update({ kind: "error", message });
          writeVisible(line);
        },
      });

      ws.onopen = () => {
        clearOpenTimer();
        reconnectDelay = RECONNECT_BASE_MS;
        attempt = 0;
        update({ kind: "connected" });
      };
      ws.onerror = () => {
        clearOpenTimer();
        update({ kind: "error", message: "WebSocket error" });
      };
      ws.onclose = (e) => {
        clearOpenTimer();
        if (disposed) return;
        // Code 1000 is a deliberate server-side end (the shell exited).
        // Leave it closed. Any other code is an abnormal drop, so reconnect
        // with exponential backoff. The server spawns a fresh shell per
        // connection, so this starts a new session rather than resuming.
        if (e.code === 1000) {
          update({ kind: "closed", code: e.code, reason: e.reason });
          return;
        }
        attempt += 1;
        update({ kind: "reconnecting", attempt });
        writeVisible(
          `\r\n\x1b[33m[connection lost, reconnecting in ${Math.round(reconnectDelay / 1000)}s…]\x1b[0m\r\n`,
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
      // Cancel a step-up prompt this instance is waiting on, never let a
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
