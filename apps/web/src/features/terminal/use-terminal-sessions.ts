import { useCallback, useEffect, useRef, useState } from "react";

import type { ConnState } from "./components/terminal-session";
import type { SessionSource, Session } from "./types";
import type { TerminalSearch } from "./url";

import { describeSource } from "./types";
import { encodeSessionToken, sessionSourcesFromSearch } from "./url";

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeSession(source: SessionSource): Session {
  return { id: newId(), label: describeSource(source), source };
}

/** The shape written back into the URL. `undefined` clears the param. */
export interface TerminalUrlState {
  session: string[] | undefined;
  active: number | undefined;
}

export interface TerminalSessions {
  sessions: Session[];
  activeId: string | null;
  activeSession: Session | null;
  connStates: Record<string, ConnState>;
  open: (source: SessionSource) => void;
  close: (id: string) => void;
  select: (id: string) => void;
  setConn: (id: string, conn: ConnState) => void;
}

/**
 * Owns the open-session list for both terminal surfaces (the in-app page and
 * the popout window) and keeps the URL in step with it.
 *
 * The URL is hydrated exactly once, on mount, and is a one-way reflection of
 * `sessions` afterwards. Later search-param changes from outside — a manual
 * edit, history back — are deliberately ignored: re-deriving sessions from
 * them would tear live WebSockets out from under the user for what is
 * cosmetically the same tab.
 */
export function useTerminalSessions(
  search: TerminalSearch,
  syncUrl: (next: TerminalUrlState) => void,
): TerminalSessions {
  // sessions + activeId move together (closing the focused tab has to pick a
  // new one), so they share a single state object rather than racing as two.
  const [state, setState] = useState<{
    sessions: Session[];
    activeId: string | null;
  }>(() => {
    const sessions = sessionSourcesFromSearch(search).map(makeSession);
    return { sessions, activeId: sessions[search.active ?? 0]?.id ?? null };
  });
  const [connStates, setConnStates] = useState<Record<string, ConnState>>({});

  const { sessions, activeId } = state;

  // Pinned in a ref so routes can pass an inline arrow without the sync effect
  // re-firing on every render.
  const syncRef = useRef(syncUrl);
  useEffect(() => {
    syncRef.current = syncUrl;
  });

  // Mirror the session list back into the URL so reload / share restores every
  // tab. Index 0 is the default, so it stays out of the URL.
  useEffect(() => {
    const tokens = sessions.map((s) => encodeSessionToken(s.source));
    const index = sessions.findIndex((s) => s.id === activeId);
    syncRef.current({
      session: tokens.length > 0 ? tokens : undefined,
      active: index > 0 ? index : undefined,
    });
  }, [sessions, activeId]);

  const open = useCallback((source: SessionSource) => {
    const next = makeSession(source);
    setState((prev) => ({
      sessions: [...prev.sessions, next],
      activeId: next.id,
    }));
  }, []);

  const close = useCallback((id: string) => {
    setState((prev) => {
      const sessions = prev.sessions.filter((s) => s.id !== id);
      if (prev.activeId !== id) return { sessions, activeId: prev.activeId };
      return { sessions, activeId: sessions[sessions.length - 1]?.id ?? null };
    });
    setConnStates(({ [id]: _closed, ...rest }) => rest);
  }, []);

  const select = useCallback((id: string) => {
    setState((prev) => ({ ...prev, activeId: id }));
  }, []);

  const setConn = useCallback((id: string, conn: ConnState) => {
    setConnStates((prev) => ({ ...prev, [id]: conn }));
  }, []);

  return {
    sessions,
    activeId,
    activeSession: sessions.find((s) => s.id === activeId) ?? null,
    connStates,
    open,
    close,
    select,
    setConn,
  };
}
