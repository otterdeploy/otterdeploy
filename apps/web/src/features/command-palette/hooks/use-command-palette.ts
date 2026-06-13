import { useSyncExternalStore } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";

// Shared open-state so the palette can be toggled from anywhere (the Mod+K
// hotkey AND the user menu's "Command menu" item) and stay in sync. A tiny
// external store rather than a context — no provider to thread through.
let isOpen = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Open/close the command palette imperatively from anywhere. */
export function setCommandPaletteOpen(next: boolean): void {
  if (isOpen === next) return;
  isOpen = next;
  emit();
}

/**
 * Subscribe to the shared command-palette state and register the Mod+K hotkey.
 * Mount this once (in the <CommandPalette/> itself). Callers that only need to
 * OPEN it (e.g. a menu item) should import `setCommandPaletteOpen` instead, so
 * the hotkey isn't registered twice.
 */
export function useCommandPalette(): {
  open: boolean;
  setOpen: (next: boolean) => void;
  toggle: () => void;
} {
  const open = useSyncExternalStore(
    subscribe,
    () => isOpen,
    () => isOpen,
  );

  useHotkey("Mod+K", (event) => {
    event.preventDefault();
    setCommandPaletteOpen(!isOpen);
  });

  return {
    open,
    setOpen: setCommandPaletteOpen,
    toggle: () => setCommandPaletteOpen(!isOpen),
  };
}
