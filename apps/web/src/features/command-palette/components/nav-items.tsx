/**
 * Static command-palette navigation data + the small presentational pieces
 * (group renderer, footer hints) split out of `command-palette.tsx` to keep
 * that component under the file/function size limits. Only routes that really
 * exist are listed — unbuilt sidebar entries are intentionally omitted.
 */

import {
  Alert01Icon,
  Certificate01Icon,
  ChartLineData01Icon,
  DashboardSquare01Icon,
  Database02Icon,
  DatabaseIcon,
  EarthIcon,
  File01Icon,
  FlashIcon,
  Folder01Icon,
  GitBranchIcon,
  HardDriveIcon,
  Home01Icon,
  Key01Icon,
  Key02Icon,
  PackageIcon,
  RocketIcon,
  ServerStack01Icon,
  Settings01Icon,
  ShieldKeyIcon,
  SourceCodeIcon,
  UserCircleIcon,
  UserMultipleIcon,
  WebhookIcon,
  WorkflowSquare01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { RoutePath } from "@/features/shell/components/sidebar";

import { CommandGroup, CommandItem } from "@/shared/components/ui/command";
import { Kbd, KbdGroup } from "@/shared/components/ui/kbd";

type IconType = typeof Folder01Icon;

export interface NavEntry {
  to: RoutePath;
  label: string;
  icon: IconType;
  keywords?: string[];
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

// Org-scoped destinations, grouped + ordered to match the sidebar
// (`navGroups` in shell/.../project-sidebar.tsx). Only routes that really
// exist are listed — unbuilt sidebar placeholders are intentionally omitted,
// which is why some groups are shorter here than in the sidebar.
export const ORG_NAV_GROUPS: readonly { heading: string; items: readonly NavEntry[] }[] = [
  {
    heading: "Workspace",
    items: [
      { to: "/$orgSlug", label: "Projects", icon: Home01Icon },
      {
        to: "/$orgSlug/templates",
        label: "Templates",
        icon: PackageIcon,
        keywords: ["gallery", "stacks", "deploy", "catalog"],
      },
      {
        to: "/$orgSlug/servers",
        label: "Servers",
        icon: ServerStack01Icon,
        keywords: ["nodes", "swarm"],
      },
      { to: "/$orgSlug/terminal", label: "Terminal", icon: FlashIcon, keywords: ["shell", "ssh"] },
    ],
  },
  {
    heading: "Networking & Edge",
    items: [
      {
        to: "/$orgSlug/networking",
        label: "Networking",
        icon: EarthIcon,
        keywords: ["domains", "routes", "caddy"],
      },
      {
        to: "/$orgSlug/edge-logs",
        label: "Edge logs",
        icon: EarthIcon,
        keywords: ["access", "traffic"],
      },
      {
        to: "/$orgSlug/firewall",
        label: "Firewall",
        icon: ShieldKeyIcon,
        keywords: ["crowdsec", "blocklist", "ip"],
      },
      {
        to: "/$orgSlug/certificates",
        label: "Certificates",
        icon: Certificate01Icon,
        keywords: ["tls", "ssl", "pem", "ca", "acme"],
      },
    ],
  },
  {
    heading: "Data & Runtime",
    items: [
      {
        to: "/$orgSlug/databases",
        label: "Databases",
        icon: Database02Icon,
        keywords: ["postgres", "redis", "mysql", "mongo", "catalog"],
      },
      {
        to: "/$orgSlug/backups",
        label: "Backups",
        icon: DatabaseIcon,
        keywords: ["restore", "snapshot"],
      },
      {
        to: "/$orgSlug/volumes",
        label: "Volumes",
        icon: HardDriveIcon,
        keywords: ["storage", "disk", "orphan"],
      },
      {
        to: "/$orgSlug/docker",
        label: "Docker",
        icon: ServerStack01Icon,
        keywords: ["containers", "images"],
      },
      {
        to: "/$orgSlug/registries",
        label: "Registries",
        icon: Database02Icon,
        keywords: ["docker", "image"],
      },
    ],
  },
  {
    heading: "Observability",
    items: [
      {
        to: "/$orgSlug/platform",
        label: "Platform",
        icon: FlashIcon,
        keywords: ["health", "queues", "deploys"],
      },
      {
        to: "/$orgSlug/audit",
        label: "Audit",
        icon: File01Icon,
        keywords: ["activity", "history"],
      },
    ],
  },
  {
    heading: "Integrations",
    items: [
      {
        to: "/$orgSlug/git-providers",
        label: "Git providers",
        icon: GitBranchIcon,
        keywords: ["github", "source"],
      },
      {
        to: "/$orgSlug/webhooks",
        label: "Webhooks",
        icon: WebhookIcon,
        keywords: ["hmac", "deliveries", "inbound", "events"],
      },
      {
        to: "/$orgSlug/notifications",
        label: "Notifications",
        icon: Alert01Icon,
        keywords: ["slack", "discord", "alerts"],
      },
    ],
  },
  {
    heading: "Organization",
    items: [
      {
        to: "/$orgSlug/team",
        label: "Team",
        icon: UserMultipleIcon,
        keywords: ["members", "invite"],
      },
      {
        to: "/$orgSlug/api-keys",
        label: "API tokens",
        icon: Key02Icon,
        keywords: ["keys", "access"],
      },
      {
        to: "/$orgSlug/ssh-keys",
        label: "SSH keys",
        icon: Key01Icon,
        keywords: ["ssh", "deploy key", "git", "node"],
      },
      {
        to: "/$orgSlug/account",
        label: "Account",
        icon: UserCircleIcon,
        keywords: ["profile", "sessions", "password", "2fa", "security"],
      },
      { to: "/$orgSlug/settings", label: "Settings", icon: Settings01Icon },
      {
        to: "/$orgSlug/instance",
        label: "Instance",
        icon: Settings01Icon,
        keywords: ["instance", "platform", "server ip", "control plane", "acme", "email"],
      },
    ],
  },
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
          keywords={item.keywords}
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
