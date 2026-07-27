/**
 * Persisted UI state for the bottom stack drawer: open/collapsed, active tab,
 * and drag-resized height — stored per project in localStorage so the
 * workspace reopens the way the operator left it. Hoisted out of
 * StackCodePanel so the graph layout can read the drawer's occupied height
 * and lift its bottom-anchored chrome (Controls / legend) above it.
 */

import { useEffect, useRef, useState } from "react";

import type { StackTab } from "./panel-header";

const PANEL_MIN_HEIGHT = 160;
const PANEL_MAX_VH = 0.7;
const PANEL_DEFAULT_HEIGHT = 360;
/** Header strip height (h-10) — the drawer's footprint while collapsed. */
export const PANEL_COLLAPSED_HEIGHT = 40;

interface PanelState {
  open: boolean;
  tab: StackTab;
  height: number;
}

const storageKey = (projectId: string) => `otterdeploy:stack-panel:${projectId}`;

function clampHeight(h: number): number {
  const max =
    typeof window === "undefined" ? Number.POSITIVE_INFINITY : window.innerHeight * PANEL_MAX_VH;
  return Math.round(Math.min(Math.max(h, PANEL_MIN_HEIGHT), max));
}

/** `defaultOpen` only applies the first time a project's drawer is ever
 *  read (no stored preference) — a brand-new project with zero resources
 *  has nothing to show but boilerplate YAML, so it starts collapsed instead
 *  of covering the empty-state CTA underneath. Any explicit operator
 *  preference from a prior open/close always wins. */
function readState(projectId: string, defaultOpen: boolean): PanelState {
  const defaults: PanelState = { open: defaultOpen, tab: "stack", height: PANEL_DEFAULT_HEIGHT };
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<PanelState>;
    const tab: StackTab =
      parsed.tab === "activity" || parsed.tab === "traffic" ? parsed.tab : "stack";
    return {
      open: parsed.open ?? defaultOpen,
      tab,
      height: clampHeight(typeof parsed.height === "number" ? parsed.height : PANEL_DEFAULT_HEIGHT),
    };
  } catch {
    return defaults;
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

/** `defaultOpen` — the drawer's first-visit-ever default (see readState);
 *  defaults to `true` so existing callers that don't pass it keep the prior
 *  always-open behavior. Only the graph route (which knows whether the
 *  project has any resources yet) overrides it. */
export function useStackPanelState(projectId: string, defaultOpen = true): StackPanelState {
  const [state, setState] = useState<PanelState>(() => readState(projectId, defaultOpen));
  const [dragging, setDragging] = useState(false);

  // Same component instance survives project→project navigation (the route
  // layout re-renders with new params, no remount) — re-read on key change.
  const prevProjectId = useRef(projectId);
  useEffect(() => {
    if (prevProjectId.current === projectId) return;
    prevProjectId.current = projectId;
    // defaultOpen is a first-render hint, not a reactive dependency —
    // re-reading on it changing would fight the operator's own toggle.
    setState(readState(projectId, defaultOpen));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
