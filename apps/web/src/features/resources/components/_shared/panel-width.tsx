/**
 * How wide the resource drawer is, and who remembers it.
 *
 * Two states, deliberately: the default sheet (`xl:w-3/5`, canvas still
 * visible beside it) and full width. A third intermediate size sounds
 * generous and is really a decision the operator has to make again every
 * time; a drag handle can come later on top of a control that already exists.
 *
 * The preference is per ACCOUNT, not per resource: you either work wide or you
 * don't, and re-expanding on every panel you open is the thing a remembered
 * width exists to prevent. It lives in localStorage rather than the URL
 * because it is about this person's screen, not about what they are looking
 * at — a link someone shares must open on the recipient's preference, not the
 * sender's.
 */

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const STORAGE_KEY = "otterdeploy.panel.expanded";

interface PanelWidthValue {
  expanded: boolean;
  toggle: () => void;
}

/**
 * localStorage as an external store.
 *
 * Not `useState` + an effect that reads storage: that is a setState inside an
 * effect, which cascades a second render on every panel mount. This is the
 * shape React provides for exactly this — the server snapshot is `false`, the
 * client's is whatever was stored, and React reconciles the difference after
 * hydration without a mismatch.
 *
 * The `storage` subscription is a small bonus: expand in one tab and the
 * others follow, rather than disagreeing until they reload.
 */
const listeners = new Set<() => void>();

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Private window, or site data blocked. Collapsed is the safe answer.
    return false;
  }
}

// Read once at module load so `getSnapshot` is stable between notifications:
// returning a fresh read on every call would loop React's re-render check.
let snapshot = typeof window === "undefined" ? false : readStored();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    snapshot = readStored();
    for (const listener of listeners) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function setStored(next: boolean): void {
  snapshot = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // Storage denied: the preference lasts for this session only.
  }
  for (const listener of listeners) listener();
}

/**
 * Null means "this panel isn't in a resizable container" — the header then
 * renders no expand control at all rather than a button that does nothing.
 * Panels are used outside the graph drawer (tests, previews), so this has to
 * degrade rather than throw.
 */
const PanelWidthContext = createContext<PanelWidthValue | null>(null);

export function usePanelWidth(): PanelWidthValue | null {
  return useContext(PanelWidthContext);
}

/** True when the panel is expanded; false both when collapsed and when the
 *  panel isn't resizable at all. The rail and the per-tab width rules key off
 *  this, and "not resizable" must read as "narrow". */
export function usePanelExpanded(): boolean {
  return useContext(PanelWidthContext)?.expanded ?? false;
}

export function PanelWidthProvider({
  children,
  render,
}: {
  children: ReactNode;
  /** The shell renders its own wrapper from the state, so it takes the value
   *  as a render prop rather than reading a hook it also provides. */
  render: (expanded: boolean, children: ReactNode) => ReactNode;
}) {
  const expanded = useSyncExternalStore(
    subscribe,
    () => snapshot,
    // Server render is always collapsed: there is no storage to read, and
    // guessing wide would ship a layout the operator never chose.
    () => false,
  );
  const toggle = useCallback(() => {
    setStored(!snapshot);
  }, []);

  return (
    <PanelWidthContext.Provider value={{ expanded, toggle }}>
      {render(expanded, children)}
    </PanelWidthContext.Provider>
  );
}

/**
 * The reading measure for a pane that must NOT use the extra width.
 *
 * A settings form stretched to 1400px is worse than a narrow one: the label is
 * at one end of the screen and its control at the other. Expanding buys room
 * for logs and compose files, not for two-field forms — so those cap, and the
 * leftover space is left visibly empty rather than filled by stretching.
 *
 * Left-aligned, not centred: the pane sits beside a rail, and a form floating
 * in the middle of the empty space reads as unanchored while every other tab's
 * content starts at the same left edge.
 */
export const PANE_MEASURE_CLASS = "w-full max-w-3xl";
