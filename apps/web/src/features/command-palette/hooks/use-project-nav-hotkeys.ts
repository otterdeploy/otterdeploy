import { useHotkeySequence } from "@tanstack/react-hotkeys";

import type { RoutePath } from "@/features/shell/components/sidebar";

import { useIsOverlayOpen } from "@/shared/hooks/use-is-overlay-open";

/**
 * `G` then a letter jumps to a project tab (Linear-style). Each binding is an
 * explicit hook call — rules-of-hooks forbids looping `useHotkeySequence`, and
 * the set is fixed anyway. Keep the chords in sync with the `chord` labels on
 * `PROJECT_NAV` (the palette renders those next to each item).
 *
 * `go` is the palette's `goProject`, which no-ops when no project is in scope,
 * so these stay registered globally but only fire inside a project.
 *
 * Guarded by `useIsOverlayOpen`: the library's built-in `ignoreInputs` only
 * checks whether focus is inside an <input>/<textarea>/contenteditable, so a
 * bare "g" then "n" typed while a dialog is open (but focus is on a
 * non-input element inside it) used to fall through and navigate the page —
 * closing the dialog out from under the user. Disabling the sequences
 * outright while any dialog is open closes that gap without touching
 * `ignoreInputs` itself (still needed for regular text fields).
 */
export function useProjectNavHotkeys(go: (to: RoutePath) => void): void {
  const overlayOpen = useIsOverlayOpen();
  const enabled = !overlayOpen;

  // No "G O" — there's no Overview tab (project index redirects to /graph).
  useHotkeySequence(["G", "G"], () => go("/$orgSlug/$projectSlug/graph"), { enabled });
  useHotkeySequence(["G", "D"], () => go("/$orgSlug/$projectSlug/deployments"), { enabled });
  useHotkeySequence(["G", "L"], () => go("/$orgSlug/$projectSlug/logs"), { enabled });
  useHotkeySequence(["G", "M"], () => go("/$orgSlug/$projectSlug/metrics"), { enabled });
  useHotkeySequence(["G", "V"], () => go("/$orgSlug/$projectSlug/variables"), { enabled });
  useHotkeySequence(["G", "N"], () => go("/$orgSlug/$projectSlug/networking"), { enabled });
  useHotkeySequence(["G", "E"], () => go("/$orgSlug/$projectSlug/edge-logs"), { enabled });
  useHotkeySequence(["G", "S"], () => go("/$orgSlug/$projectSlug/settings"), { enabled });
}
