/**
 * Command-palette navigation data + the small presentational pieces
 * (group renderer, footer hints) split out of `command-palette.tsx` to keep
 * that component under the file/function size limits.
 *
 * Org-level destinations derive from the typed nav manifest
 * (`features/shell/nav-manifest.ts`) — the same source the operational
 * sidebar and the settings-zone rail render from — so the palette can't
 * drift from the visible navigation. Project-scoped destinations mirror the
 * project tab row and stay local to this file.
 */

import {
  ChartLineData01Icon,
  EarthIcon,
  File01Icon,
  Folder01Icon,
  RocketIcon,
  Settings01Icon,
  SourceCodeIcon,
  WorkflowSquare01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { RoutePath } from "@/features/shell/components/sidebar";

import {
  OPERATIONAL_NAV,
  PALETTE_EXTRA_NAV,
  SETTINGS_NAV,
  type NavManifestItem,
} from "@/features/shell/nav-manifest";
import { CommandGroup, CommandItem } from "@/shared/components/ui/command";
import { Kbd, KbdGroup } from "@/shared/components/ui/kbd";

type IconType = typeof Folder01Icon;

export interface NavEntry {
  to: RoutePath;
  label: string;
  icon: IconType;
  keywords?: readonly string[];
  /** Second key in the `G <key>` jump sequence — see use-project-nav-hotkeys. */
  chord?: string;
}

// Project-scoped destinations — mirror the project tab row. `to` values are the
// same typed RoutePaths the tabs use. `chord` is the displayed + bound `G <key>`
// shortcut; keep it in sync with `useProjectNavHotkeys`.
export const PROJECT_NAV: readonly NavEntry[] = [
  // No "Overview" entry: the project index route redirects to /graph (the
  // graph IS the project overview), so it never activated as its own
  // destination — see project-tabs.tsx.
  {
    to: "/$orgSlug/$projectSlug/graph",
    label: "Graph",
    icon: WorkflowSquare01Icon,
    chord: "G",
    keywords: ["topology", "resources"],
  },
  {
    to: "/$orgSlug/$projectSlug/deployments",
    label: "Deployments",
    icon: RocketIcon,
    chord: "D",
    keywords: ["deploys", "rollback", "history"],
  },
  {
    to: "/$orgSlug/$projectSlug/logs",
    label: "Logs",
    icon: File01Icon,
    chord: "L",
    // Edge logs folded in as a source toggle (od-u63.5) — keep its old
    // search terms so the palette still finds this from either name.
    keywords: ["edge", "access", "traffic"],
  },
  { to: "/$orgSlug/$projectSlug/metrics", label: "Metrics", icon: ChartLineData01Icon, chord: "M" },
  {
    to: "/$orgSlug/$projectSlug/variables",
    label: "Variables",
    icon: SourceCodeIcon,
    chord: "V",
    keywords: ["env", "secrets"],
  },
  {
    to: "/$orgSlug/$projectSlug/networking",
    label: "Networking",
    icon: EarthIcon,
    chord: "N",
    keywords: ["domains", "routes", "caddy"],
  },
  // No "Edge logs" entry (od-u63.5) — merged into Logs (chord "L") as a
  // Runtime | Edge source toggle; "access"/"traffic" keywords moved onto the
  // Logs entry above so the palette still finds it from either name.
  { to: "/$orgSlug/$projectSlug/settings", label: "Settings", icon: Settings01Icon, chord: "S" },
];

const toEntry = (item: NavManifestItem): NavEntry => ({
  to: item.to,
  label: item.title,
  icon: item.icon,
  keywords: item.keywords,
});

// Org-scoped destinations, grouped + ordered to match the operational
// sidebar. The unlabeled top group renders under "Workspace" and also picks
// up PALETTE_EXTRA_NAV — creation paths (Templates, od-u63.2) that aren't
// sidebar slots but still need to be reachable from the palette. Folded into
// the same group (rather than a second one) so `heading` stays a unique
// React key across ORG_NAV_GROUPS.
export const ORG_NAV_GROUPS: readonly { heading: string; items: readonly NavEntry[] }[] = [
  ...OPERATIONAL_NAV.map((group, i) => ({
    heading: group.label ?? "Workspace",
    items: [...group.items.map(toEntry), ...(i === 0 ? PALETTE_EXTRA_NAV.map(toEntry) : [])],
  })),
  // Settings-zone destinations, one palette group per rail group, so
  // "Settings · Workspace › Git providers" stays searchable from anywhere.
  ...SETTINGS_NAV.map((group) => ({
    heading: `Settings · ${group.label}`,
    items: group.items.map(toEntry),
  })),
];

export function NavGroup({
  heading,
  items,
  onGo,
}: {
  heading: string;
  items: readonly NavEntry[];
  onGo: (to: RoutePath) => void;
}) {
  return (
    <CommandGroup heading={heading}>
      {items.map((item) => (
        <CommandItem
          key={item.label}
          // Heading prefix keeps values unique across groups (e.g. workspace
          // vs project "Networking") while staying searchable by label.
          value={`${heading} ${item.label} ${(item.keywords ?? []).join(" ")}`}
          keywords={item.keywords ? [...item.keywords] : undefined}
          onSelect={() => onGo(item.to)}
        >
          <HugeiconsIcon icon={item.icon} strokeWidth={2} />
          {item.label}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

export function PaletteFooter() {
  return (
    <div className="flex items-center gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <KbdGroup>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
        </KbdGroup>
        Navigate
      </span>
      <span className="flex items-center gap-1.5">
        <Kbd>↵</Kbd>
        Select
      </span>
      <span className="flex items-center gap-1.5">
        <Kbd>esc</Kbd>
        Close
      </span>
    </div>
  );
}
