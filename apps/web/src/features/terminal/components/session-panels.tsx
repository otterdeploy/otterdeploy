import { Activity } from "react";

import type { Session } from "../types";
import type { ConnState } from "./terminal-session";

import { TerminalSession } from "./terminal-session";

/**
 * The mounted terminals. Shared by the in-app terminal page and the popout
 * window so the two can't drift apart.
 */
export function SessionPanels({
  sessions,
  activeId,
  onConnChange,
}: {
  sessions: Session[];
  activeId: string | null;
  onConnChange: (id: string, conn: ConnState) => void;
}) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-[oklch(0.12_0_0)] p-2">
      {sessions.map((s) => {
        const isActive = s.id === activeId;
        // <Activity> keeps every session's React tree mounted across tab
        // switches: state (useState/useRef) is preserved, effects re-attach
        // cleanly on visibility flip, and we never tear down the wterm
        // <Terminal> instance. The panel is absolutely positioned rather than
        // hidden with `display: none` so an inactive terminal stays measured
        // at the panel's real size (a 0×0 measurement would make Ghostty's
        // autoResize jump-resize on switch and wreck the scrollback).
        return (
          <Activity key={s.id} mode={isActive ? "visible" : "hidden"} name={s.label}>
            <div className="absolute inset-2" aria-hidden={!isActive}>
              <TerminalSession
                source={s.source}
                active={isActive}
                onConnChange={(conn) => onConnChange(s.id, conn)}
              />
            </div>
          </Activity>
        );
      })}
    </div>
  );
}
