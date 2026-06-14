import { useHotkeySequence } from "@tanstack/react-hotkeys";

import type { RoutePath } from "@/features/shell/components/sidebar";

/**
 * `G` then a letter jumps to a project tab (Linear-style). Each binding is an
 * explicit hook call — rules-of-hooks forbids looping `useHotkeySequence`, and
 * the set is fixed anyway. Keep the chords in sync with the `chord` labels on
 * `PROJECT_NAV` (the palette renders those next to each item).
 *
 * `go` is the palette's `goProject`, which no-ops when no project is in scope,
 * so these stay registered globally but only fire inside a project.
 */
export function useProjectNavHotkeys(go: (to: RoutePath) => void): void {
  useHotkeySequence(["G", "O"], () => go("/$orgSlug/$projectSlug"));
  useHotkeySequence(["G", "G"], () => go("/$orgSlug/$projectSlug/graph"));
  useHotkeySequence(["G", "L"], () => go("/$orgSlug/$projectSlug/logs"));
  useHotkeySequence(["G", "M"], () => go("/$orgSlug/$projectSlug/metrics"));
  useHotkeySequence(["G", "V"], () => go("/$orgSlug/$projectSlug/variables"));
  useHotkeySequence(["G", "N"], () => go("/$orgSlug/$projectSlug/networking"));
  useHotkeySequence(["G", "E"], () => go("/$orgSlug/$projectSlug/edge-logs"));
  useHotkeySequence(["G", "S"], () => go("/$orgSlug/$projectSlug/settings"));
}
