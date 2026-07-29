import { useSyncExternalStore } from "react";

const OPEN_OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"]';

function overlayIsOpen(): boolean {
  return typeof document !== "undefined" && document.querySelector(OPEN_OVERLAY_SELECTOR) !== null;
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/**
 * True while any Radix dialog/alert-dialog is open anywhere in the app (the
 * new-resource wizard, edit dialogs, confirm prompts, the command palette
 * itself, …). Radix only renders the `role="dialog"`/`"alertdialog"` node
 * into the DOM while open and removes it on close, so a MutationObserver on
 * `<body>` reflects open/close globally without every dialog having to
 * report its own state to a shared store.
 *
 * Built for guarding global single-letter/sequence hotkeys (see
 * `useProjectNavHotkeys`, the palette's `D` shortcut): the library's own
 * `ignoreInputs` only checks whether focus sits inside an <input>/
 * <textarea>/contenteditable, so a hotkey still fires while a dialog is open
 * but focus is on a non-input element inside it (a card, a tab, the dialog
 * body). That let a stray keystroke close an open dialog by navigating the
 * page out from under it.
 */
export function useIsOverlayOpen(): boolean {
  // The DOM is the store here, so read it as one: no mirrored state to seed and
  // then re-sync from an effect, and no window where the hook reports `false`
  // because the observer hasn't been attached yet.
  return useSyncExternalStore(subscribe, overlayIsOpen, () => false);
}
