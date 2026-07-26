import { useEffect, useRef } from "react";

// @ts-expect-error — CSS-only side-effect import; @wterm/react ships a
// `/css` entry that Vite injects. No type declarations.
import "@wterm/react/css";
import { GhosttyCore } from "@wterm/ghostty";
import { Terminal, useTerminal, type WTerm } from "@wterm/react";

import type { ClientMessage } from "@/messages";

import { Spinner } from "@/shared/components/ui/spinner";

import type { ConnState } from "../data/use-shell-connection";
import type { SessionSource } from "../types";

import { useShellConnection } from "../data/use-shell-connection";
import { StepUpDialog } from "./step-up-dialog";

export type { ConnState } from "../data/use-shell-connection";

// Load the Ghostty WASM core once for the whole module — expensive (network
// + compile) and the same instance can drive any number of <Terminal>s.
const core = await GhosttyCore.load();

interface Props {
  source: SessionSource;
  /** Whether this session is the visible tab — inactive sessions stay mounted
   *  with `display: none` so their WebSocket + terminal state survives tab
   *  switches. */
  active: boolean;
  onConnChange?: (conn: ConnState) => void;
}

function targetLabel(source: SessionSource): string {
  switch (source.kind) {
    case "container":
      return `${source.service} · ${source.replica}`;
    case "ssh":
      return source.mode === "local" ? "the host shell" : `ssh · ${source.node}`;
    case "database":
      return `db · ${source.service}`;
  }
}

export function TerminalSession({ source, active, onConnChange }: Props) {
  const { ref, write } = useTerminal();
  const { wsRef, hasOutput, stepUpPromptOpen, resolveStepUp, cancelStepUp } = useShellConnection(source, {
    write,
    onConnChange,
  });

  // Scrollback. wterm keeps a 10k-line history and prepends it into its root
  // element, flipping that element to `overflow-y:auto` once there's history
  // (`.wterm.has-scrollback`). In our embedding the wheel event was bubbling
  // past that scroll container and scrolling the page instead of the buffer,
  // so history was effectively unreachable. Capture the wheel on the terminal
  // element and drive `scrollTop` ourselves — and only swallow the event when
  // there's actually scrollback to move through, so a terminal that fits its
  // viewport still lets the page scroll normally.
  const detachWheelRef = useRef<(() => void) | null>(null);
  const handleReady = (wt: WTerm) => {
    const el = wt.element;
    const onWheel = (e: WheelEvent) => {
      // scrollHeight > clientHeight means there's history above the viewport.
      if (el.scrollHeight - el.clientHeight <= 1) return;
      // Normalise the delta: trackpads report pixels (deltaMode 0), but mouse
      // wheels often report lines (1) or pages (2), which would otherwise
      // scroll a few pixels per notch.
      const step = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      el.scrollTop += e.deltaY * step;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    detachWheelRef.current = () => el.removeEventListener("wheel", onWheel);
  };
  useEffect(() => () => detachWheelRef.current?.(), []);

  // Visibility is handled by the parent (absolute-positioned overlay so the
  // terminal stays measured at the parent's real size when inactive — the
  // old `display: none` toggle made Ghostty's autoResize see 0×0 and then
  // jump-resize on switch, which wrecked the scrollback).
  void active;
  // Before the shell's first prompt lands, the xterm surface is just an empty
  // black rect — indistinguishable from "broken". Cover it until the first
  // byte of real content (success or error) actually lands.
  const showConnecting = !hasOutput;
  return (
    <div className="relative h-full w-full overflow-hidden">
      <Terminal
        ref={ref}
        core={core}
        autoResize
        // `wterm-fill`, not `absolute inset-0`: the vendor stylesheet is
        // unlayered and outranks Tailwind utilities, so the override has to
        // live in index.css at `.wterm.wterm-fill`. See the note there.
        className="wterm-fill"
        onReady={handleReady}
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
      {showConnecting ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[oklch(0.12_0_0)]">
          <Spinner className="size-4 text-muted-foreground" />
          <span className="font-mono text-[11px] text-muted-foreground">Connecting…</span>
        </div>
      ) : null}
      <StepUpDialog
        open={stepUpPromptOpen}
        targetLabel={targetLabel(source)}
        onVerified={resolveStepUp}
        onCancel={() => cancelStepUp(new Error("Sign-in cancelled."))}
      />
    </div>
  );
}
