import { GhosttyCore } from "@wterm/ghostty";
import { Terminal, useTerminal } from "@wterm/react";
// @ts-expect-error — CSS-only side-effect import; @wterm/react ships a
// `/css` entry that Vite injects. No type declarations.
import "@wterm/react/css";
import { useEffect, useRef, useState } from "react";

import { ClientMessage, ServerMessage } from "@/messages";
import { env } from "@otterstack/env/web";

import type { SessionSource } from "../types";

// Load the Ghostty WASM core once for the whole module — expensive (network
// + compile) and the same instance can drive any number of <Terminal>s.
const core = await GhosttyCore.load();

export type ConnState =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "closed"; code?: number; reason?: string }
  | { kind: "error"; message: string };

type Props = {
  source: SessionSource;
  /** Whether this session is the visible tab — inactive sessions stay mounted
   *  with `display: none` so their WebSocket + terminal state survives tab
   *  switches. */
  active: boolean;
  onConnChange?: (conn: ConnState) => void;
};

function buildWsUrl(source: SessionSource): string | null {
  const base = env.VITE_SERVER_URL.replace(/^http/, "ws");
  switch (source.kind) {
    case "container":
      return `${base}/pty?container=${encodeURIComponent(source.containerId)}`;
    case "ssh":
      // Local SSH ("localhost") is the otterstack-server host shell — a real
      // implemented backend reached via an explicit `?host=1` switch.
      // Remote SSH (real ssh hop into a swarm node) isn't wired yet.
      if (source.mode === "local") return `${base}/pty?host=1`;
      return null;
    case "database":
      return null;
  }
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

export function TerminalSession({ source, active, onConnChange }: Props) {
  const { ref, write } = useTerminal();
  const wsRef = useRef<WebSocket | null>(null);
  const [, setConn] = useState<ConnState>({ kind: "connecting" });

  // Pin write + onConnChange in refs so the WebSocket effect doesn't re-run
  // when the parent re-renders. Without this, every parent render would tear
  // down and reopen the WebSocket — which is what makes two sessions to the
  // same host clobber each other (the new socket replaces the old before the
  // server has spawned the second shell).
  const writeRef = useRef(write);
  useEffect(() => {
    writeRef.current = write;
  }, [write]);
  const onConnChangeRef = useRef(onConnChange);
  useEffect(() => {
    onConnChangeRef.current = onConnChange;
  }, [onConnChange]);

  useEffect(() => {
    const url = buildWsUrl(source);
    if (!url) {
      const msg = notImplementedMessage(source);
      if (msg) writeRef.current(msg);
      onConnChangeRef.current?.({
        kind: "error",
        message: `${source.kind} backend not implemented`,
      });
      return;
    }

    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.binaryType = "arraybuffer";

    const update = (next: ConnState) => {
      setConn(next);
      onConnChangeRef.current?.(next);
    };

    ws.onopen = () => update({ kind: "connected" });
    ws.onerror = () => update({ kind: "error", message: "WebSocket error" });
    ws.onclose = (e) => update({ kind: "closed", code: e.code, reason: e.reason });

    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        writeRef.current(new Uint8Array(e.data));
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
          writeRef.current(`\r\n[process exited${detail}]\r\n`);
          return;
        }
        case "error":
          update({ kind: "error", message: `[${msg.code}] ${msg.message}` });
          writeRef.current(`\r\n[${msg.code}] ${msg.message}\r\n`);
          return;
        default: {
          const _exhaustive: never = msg;
          return _exhaustive;
        }
      }
    };

    return () => {
      wsRef.current = null;
      ws.close();
    };
  }, [source]);

  // Visibility is handled by the parent (absolute-positioned overlay so the
  // terminal stays measured at the parent's real size when inactive — the
  // old `display: none` toggle made Ghostty's autoResize see 0×0 and then
  // jump-resize on switch, which wrecked the scrollback).
  void active;
  return (
    <div className="relative h-full w-full overflow-hidden">
      <Terminal
        ref={ref}
        core={core}
        autoResize
        className="absolute inset-0"
        onData={(data) => {
          const ws = wsRef.current;
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(new TextEncoder().encode(data));
          }
        }}
        onResize={(cols, rows) => {
          const ws = wsRef.current;
          if (ws?.readyState !== WebSocket.OPEN) return;
          const msg: ClientMessage = { type: "session:resize", cols, rows };
          ws.send(JSON.stringify(msg));
        }}
      />
    </div>
  );
}
