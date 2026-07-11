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
  DashboardSquare01Icon,
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

import { OPERATIONAL_NAV, SETTINGS_NAV, type NavManifestItem } from "@/features/shell/nav-manifest";
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
  { to: "/$orgSlug/$projectSlug", label: "Overview", icon: DashboardSquare01Icon, chord: "O" },
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
    keywords: ["deploys", "rollback", "history"],
  },
  { to: "/$orgSlug/$projectSlug/logs", label: "Logs", icon: File01Icon, chord: "L" },
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
  {
    to: "/$orgSlug/$projectSlug/edge-logs",
    label: "Edge logs",
    icon: EarthIcon,
    chord: "E",
    keywords: ["access", "traffic"],
  },
  { to: "/$orgSlug/$projectSlug/settings", label: "Settings", icon: Settings01Icon, chord: "S" },
];

const toEntry = (item: NavManifestItem): NavEntry => ({
  to: item.to,
  label: item.title,
  icon: item.icon,
  keywords: item.keywords,
});

// Org-scoped destinations, grouped + ordered to match the operational
// sidebar. The unlabeled top group renders under "Workspace".
export const ORG_NAV_GROUPS: readonly { heading: string; items: readonly NavEntry[] }[] = [
  ...OPERATIONAL_NAV.map((group) => ({
    heading: group.label ?? "Workspace",
    items: group.items.map(toEntry),
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
