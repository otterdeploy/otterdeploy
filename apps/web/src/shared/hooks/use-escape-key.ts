/**
 * Escape closes the top-most layer, one step at a time.
 *
 * The graph stacks routes: `/graph` → `/graph/$resourceId` →
 * `…/deployment/$deploymentId`. Each level already knows how to close itself
 * (animate out, then navigate to its parent); none of them listened for Escape,
 * so the only way back out was the mouse.
 *
 * `enabled` is what keeps this to ONE step. Every open level would otherwise
 * hear the same keydown and close together, jumping from a deployment straight
 * to the bare graph — so a level passes `false` while it has a child open and
 * lets the child answer instead.
 */

import { useEffect } from "react";

export function useEscapeKey(enabled: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      // Dialogs, popovers and menus close themselves on Escape; a text field or
      // the terminal may be using the key too (vim, a select's type-ahead).
      // Any of those means this keypress was not "go up a level".
      if (
        target?.closest("[role=dialog],[role=alertdialog],[role=menu],[role=listbox]") ||
        target?.closest("input,textarea,[contenteditable=true],.xterm")
      ) {
        return;
      }
      onEscape();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, onEscape]);
}
