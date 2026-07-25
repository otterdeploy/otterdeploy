import type { Session } from "../types";
import type { ConnState } from "./terminal-session";

import { SessionTab } from "./session-tab";

/**
 * The open-session tab strip, with its leading divider. Renders nothing when
 * there are no sessions so the header collapses to just its title chunk.
 */
export function SessionStrip({
  sessions,
  activeId,
  connStates,
  onSelect,
  onClose,
}: {
  sessions: Session[];
  activeId: string | null;
  connStates: Record<string, ConnState>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  if (sessions.length === 0) return null;

  return (
    <>
      <span className="mx-1 h-4 w-px shrink-0 bg-border/60" aria-hidden />
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {sessions.map((s) => (
          <SessionTab
            key={s.id}
            session={s}
            active={s.id === activeId}
            conn={connStates[s.id]}
            onSelect={() => onSelect(s.id)}
            onClose={() => onClose(s.id)}
          />
        ))}
      </div>
    </>
  );
}
