/**
 * Single typed source of truth for app-level navigation.
 *
 * Three consumers derive from this module — keep them in sync by editing
 * ONLY this file when a destination is added, moved, or renamed:
 *
 *   - the operational sidebar   (features/shell/components/sidebar/project-sidebar.tsx)
 *   - the settings-zone rail    (routes/_app/$orgSlug/settings/layout.tsx)
 *   - the command palette       (features/command-palette/components/nav-items.tsx)
 *
 * Two chromes, never coexisting:
 *   OPERATIONAL_NAV  — the org shell (sidebar chrome). Day-to-day operating
 *                      surfaces: projects, infrastructure, observability.
 *   SETTINGS_NAV     — the settings zone (Linear-style takeover under
 *                      `/$orgSlug/settings/*`): Account / Workspace / Instance.
 *
 * `to` values are typed against the generated route tree via `RoutePath`
 * (the `LinkProps["to"]` idiom) so a route move breaks loudly here, not
 * silently in three nav surfaces.
 */

import {
  Alert01Icon,
  Certificate01Icon,
  Database02Icon,
  DatabaseIcon,
  DeviceAccessIcon,
  EarthIcon,
  File01Icon,
  FlashIcon,
  GitBranchIcon,
  Home01Icon,
  Key01Icon,
  Key02Icon,
  PackageIcon,
  ServerStack01Icon,
  Settings01Icon,
  ShieldKeyIcon,
  UserCircleIcon,
  UserMultipleIcon,
  WebhookIcon,
} from "@hugeicons/core-free-icons";

import type { RoutePath } from "./components/sidebar";

/** Hugeicons free-icon data shape (same trick as the sidebar's NavItem). */
export type NavIcon = typeof Home01Icon;

export interface NavManifestItem {
  /** English label — also the fallback when `i18nKey` is absent or untranslated. */
  title: string;
  /** Optional i18n key; render with `t(i18nKey, title)`. */
  i18nKey?: string;
  /** Typed route path — checked against the generated route tree. */
  to: RoutePath;
  icon: NavIcon;
  /** Extra search terms for the command palette. */
  keywords?: readonly string[];
  /** Highlight only on an exact path match (e.g. the org index). */
  exact?: boolean;
}

export interface NavManifestGroup {
  /** Uppercase micro-label. Omitted for the ungrouped top items. */
  label?: string;
  items: readonly NavManifestItem[];
}

// ─── Operational shell ───────────────────────────────────────────────

export const OPERATIONAL_NAV: readonly NavManifestGroup[] = [
  {
    items: [
      {
        title: "Projects",
        i18nKey: "nav.projects",
        to: "/$orgSlug",
        icon: Home01Icon,
        exact: true,
      },
      {
        title: "Templates",
        to: "/$orgSlug/templates",
        icon: PackageIcon,
        keywords: ["gallery", "stacks", "deploy", "catalog"],
      },
      {
        title: "Terminal",
        i18nKey: "nav.terminal",
        to: "/$orgSlug/terminal",
        icon: FlashIcon,
        keywords: ["shell", "ssh"],
      },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      {
        title: "Servers",
        i18nKey: "nav.servers",
        to: "/$orgSlug/servers",
        icon: ServerStack01Icon,
        keywords: ["nodes", "swarm"],
      },
      {
        title: "Docker",
        to: "/$orgSlug/docker",
        icon: ServerStack01Icon,
        // Volumes folded into Docker as a tab — keep its old search terms.
        keywords: ["containers", "images", "volumes", "storage", "disk", "orphan"],
      },
      {
        title: "Backups",
        to: "/$orgSlug/backups",
        icon: DatabaseIcon,
        keywords: ["restore", "snapshot"],
      },
      {
        title: "Networking",
        i18nKey: "nav.networking",
        to: "/$orgSlug/networking",
        icon: EarthIcon,
        keywords: ["domains", "routes", "caddy"],
      },
    ],
  },
  {
    label: "Observability",
    items: [
      {
        title: "Platform",
        to: "/$orgSlug/platform",
        icon: FlashIcon,
        keywords: ["health", "queues", "deploys"],
      },
      {
        title: "Edge logs",
        to: "/$orgSlug/edge-logs",
        icon: EarthIcon,
        // Firewall folded into Edge logs as a tab — keep its old search terms.
        keywords: ["access", "traffic", "firewall", "crowdsec", "blocklist", "ip"],
      },
      {
        title: "Audit",
        to: "/$orgSlug/audit",
        icon: File01Icon,
        keywords: ["activity", "history"],
      },
    ],
  },
];

/** Pinned entry at the bottom of the operational sidebar — enters the zone. */
export const SETTINGS_ENTRY: NavManifestItem = {
  title: "Settings",
  i18nKey: "nav.settings",
  to: "/$orgSlug/settings",
  icon: Settings01Icon,
  keywords: ["preferences", "configuration", "workspace", "instance", "account"],
};

// ─── Settings zone ───────────────────────────────────────────────────

/** Settings-zone groups. `label` is required — the rail always shows it. */
export interface SettingsNavGroup {
  label: string;
  items: readonly NavManifestItem[];
}

export const SETTINGS_NAV: readonly SettingsNavGroup[] = [
  {
    label: "Account",
    items: [
      {
        title: "Profile",
        to: "/$orgSlug/settings/account/profile",
        icon: UserCircleIcon,
        keywords: ["account", "avatar", "name", "email"],
      },
      {
        title: "Security",
        to: "/$orgSlug/settings/account/security",
        icon: ShieldKeyIcon,
        keywords: ["password", "2fa", "two-factor", "totp"],
      },
      {
        title: "Sessions",
        to: "/$orgSlug/settings/account/sessions",
        icon: DeviceAccessIcon,
        keywords: ["devices", "sign out", "cli", "revoke"],
      },
    ],
  },
  {
    label: "Workspace",
    items: [
      {
        title: "General",
        to: "/$orgSlug/settings/workspace/general",
        icon: Settings01Icon,
        keywords: ["domain", "cloudflare", "workspace settings"],
      },
      {
        title: "Team",
        to: "/$orgSlug/settings/workspace/team",
        icon: UserMultipleIcon,
        keywords: ["members", "invite"],
      },
      {
        title: "Git providers",
        to: "/$orgSlug/settings/workspace/git-providers",
        icon: GitBranchIcon,
        keywords: ["github", "source"],
      },
      {
        title: "API keys",
        to: "/$orgSlug/settings/workspace/api-keys",
        icon: Key02Icon,
        keywords: ["tokens", "access"],
      },
      {
        title: "SSH keys",
        to: "/$orgSlug/settings/workspace/ssh-keys",
        icon: Key01Icon,
        keywords: ["deploy key", "git", "node"],
      },
      {
        title: "Registries",
        to: "/$orgSlug/settings/workspace/registries",
        icon: Database02Icon,
        keywords: ["docker", "image"],
      },
      {
        title: "Certificates",
        to: "/$orgSlug/settings/workspace/certificates",
        icon: Certificate01Icon,
        keywords: ["tls", "ssl", "pem", "ca", "acme"],
      },
      {
        title: "Webhooks",
        to: "/$orgSlug/settings/workspace/webhooks",
        icon: WebhookIcon,
        keywords: ["hmac", "deliveries", "inbound", "events"],
      },
      {
        title: "Notifications",
        to: "/$orgSlug/settings/workspace/notifications",
        icon: Alert01Icon,
        keywords: ["slack", "discord", "alerts"],
      },
    ],
  },
  {
    label: "Instance",
    items: [
      {
        title: "General",
        to: "/$orgSlug/settings/instance/general",
        icon: ServerStack01Icon,
        keywords: [
          "instance",
          "platform",
          "server ip",
          "control plane",
          "acme",
          "email",
          "updates",
        ],
      },
    ],
  },
];
