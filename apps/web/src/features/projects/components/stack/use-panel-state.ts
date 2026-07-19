/**
 * Persisted UI state for the bottom stack drawer: open/collapsed, active tab,
 * and drag-resized height — stored per project in localStorage so the
 * workspace reopens the way the operator left it. Hoisted out of
 * StackCodePanel so the graph layout can read the drawer's occupied height
 * and lift its bottom-anchored chrome (Controls / legend) above it.
 */

import { useEffect, useRef, useState } from "react";

import type { StackTab } from "./panel-header";

export const PANEL_MIN_HEIGHT = 160;
export const PANEL_MAX_VH = 0.7;
export const PANEL_DEFAULT_HEIGHT = 360;
/** Header strip height (h-10) — the drawer's footprint while collapsed. */
export const PANEL_COLLAPSED_HEIGHT = 40;

interface PanelState {
  open: boolean;
  tab: StackTab;
  height: number;
}

const DEFAULT_STATE: PanelState = {
  open: true,
  tab: "stack",
  height: PANEL_DEFAULT_HEIGHT,
};

const storageKey = (projectId: string) => `otterdeploy:stack-panel:${projectId}`;

function clampHeight(h: number): number {
  const max =
    typeof window === "undefined" ? Number.POSITIVE_INFINITY : window.innerHeight * PANEL_MAX_VH;
  return Math.round(Math.min(Math.max(h, PANEL_MIN_HEIGHT), max));
}

function readState(projectId: string): PanelState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<PanelState>;
    const tab: StackTab =
      parsed.tab === "activity" || parsed.tab === "traffic" ? parsed.tab : "stack";
    return {
      open: parsed.open ?? true,
      tab,
      height: clampHeight(typeof parsed.height === "number" ? parsed.height : PANEL_DEFAULT_HEIGHT),
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export interface StackPanelState extends PanelState {
  /** Height the drawer currently occupies (collapsed strip when closed). */
  occupiedHeight: number;
  dragging: boolean;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setTab: (tab: StackTab) => void;
  /** Pointer-down handler for the drawer's top drag handle. */
  startDrag: (event: React.PointerEvent) => void;
}

export function useStackPanelState(projectId: string): StackPanelState {
  const [state, setState] = useState<PanelState>(() => readState(projectId));
  const [dragging, setDragging] = useState(false);

  // Same component instance survives project→project navigation (the route
  // layout re-renders with new params, no remount) — re-read on key change.
  const prevProjectId = useRef(projectId);
  useEffect(() => {
    if (prevProjectId.current === projectId) return;
    prevProjectId.current = projectId;
    setState(readState(projectId));
  }, [projectId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey(projectId), JSON.stringify(state));
    } catch {
      /* ignore quota/privacy-mode failures — state just won't persist */
    }
  }, [projectId, state]);

  const setOpen = (open: boolean) => setState((s) => ({ ...s, open }));
  const toggleOpen = () => setState((s) => ({ ...s, open: !s.open }));
  // Picking a tab always opens the drawer — a hidden tab switch is a no-op.
  const setTab = (tab: StackTab) => setState((s) => ({ ...s, tab, open: true }));

  // Mirror of the current height for the drag closure (avoids re-creating the
  // handler per resize tick).
  const heightRef = useRef(state.height);
  useEffect(() => {
    heightRef.current = state.height;
  }, [state.height]);

  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = heightRef.current;
    setDragging(true);
    const onMove = (ev: PointerEvent) => {
      const dy = startY - ev.clientY;
      setState((s) => ({ ...s, height: clampHeight(startHeight + dy) }));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return {
    ...state,
    occupiedHeight: state.open ? state.height : PANEL_COLLAPSED_HEIGHT,
    dragging,
    setOpen,
    toggleOpen,
    setTab,
    startDrag,
  };
}
