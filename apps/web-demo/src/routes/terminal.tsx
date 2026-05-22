import { env } from "@otterstack/env/web";
import { createFileRoute } from "@tanstack/react-router";
import { GhosttyCore } from "@wterm/ghostty";
import { Terminal, useTerminal } from "@wterm/react";
import "@wterm/react/css";
import { useEffect, useRef } from "react";
import * as z from "zod";
import { ClientMessage, ServerMessage } from "../messages";

const terminalSearchSchema = z.object({
  container: z.string().min(1).optional(),
});

export const Route = createFileRoute("/terminal")({
  component: RouteComponent,
  validateSearch: terminalSearchSchema,
});

const core = await GhosttyCore.load();

export function RouteComponent() {
  const { container } = Route.useSearch();
  const { ref, write } = useTerminal();
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const query = container
      ? `?container=${encodeURIComponent(container)}`
      : "";
    const url = `${env.VITE_SERVER_URL.replace(/^http/, "ws")}/pty${query}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.binaryType = "arraybuffer";

    ws.onmessage = (e) => {
      // Binary frame = PTY stdout. Render straight to the terminal.
      if (e.data instanceof ArrayBuffer) {
        write(new Uint8Array(e.data));
        return;
      }
      // Text frame = JSON control message.
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
          write(`\r\n[process exited${detail}]\r\n`);
          return;
        }
        case "error":
          write(`\r\n[${msg.code}] ${msg.message}\r\n`);
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
  }, [write, container]);

  if (!core) return <div>Loading terminal…</div>;

  return (
    <div className="row-span-2 h-full w-full">
      <Terminal
        ref={ref}
        core={core}
        autoResize
        className="h-full w-full"
        onData={(data) => {
          const ws = wsRef.current;
          // PTY stdin = binary frame. Keeps it off the control channel.
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
