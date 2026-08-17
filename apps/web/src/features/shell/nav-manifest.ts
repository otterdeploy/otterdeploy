/**
 * Single typed source of truth for app-level navigation.
 *
 * Three consumers derive from this module. Keep them in sync by editing
 * ONLY this file when a destination is added, moved, or renamed:
 *
 *   - the operational sidebar   (features/shell/components/sidebar/project-sidebar.tsx)
 *   - the settings-zone rail    (routes/_app/$orgSlug/settings/layout.tsx)
 *   - the command palette       (features/command-palette/components/nav-items.tsx)
 *
 * Two chromes, never coexisting:
 *   OPERATIONAL_NAV: the org shell (sidebar chrome). Day-to-day operating
 *                      surfaces: projects, infrastructure, observability.
 *   SETTINGS_NAV: the settings zone (Linear-style takeover under
 *                      `/$orgSlug/settings/*`): Account / Workspace / Instance.
 *
 * `to` values are typed against the generated route tree via `RoutePath`
 * (the `LinkProps["to"]` idiom) so a route move breaks loudly here, not
 * silently in three nav surfaces.
 */

import type { TranslationKey } from "@otterdeploy/i18n";

import {
  BellDotIcon,
  Database02Icon,
  DatabaseIcon,
  Analytics01Icon,
  EarthIcon,
  File01Icon,
  FlashIcon,
  GitBranchIcon,
  Home01Icon,
  Key01Icon,
  PackageIcon,
  ServerStack01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";

import type { RoutePath } from "./components/sidebar";

/** Hugeicons free-icon data shape (same trick as the sidebar's NavItem). */
export type NavIcon = typeof Home01Icon;

export interface NavManifestItem {
  /** English label: also the fallback when `i18nKey` is absent or untranslated. */
  title: string;
  /**
   * Optional i18n key; render with `t(i18nKey, title)`.
   *
   * Typed as the checked key union rather than `string`: i18next keeps a
   * `t(key: string, defaultValue: string)` overload, so a key that travels as
   * data would otherwise launder a typo past the checker.
   */
  i18nKey?: TranslationKey;
  /** Typed route path, checked against the generated route tree. */
  to: RoutePath;
  icon: NavIcon;
  /** Extra search terms for the command palette. */
  keywords?: readonly string[];
  /** Highlight only on an exact path match (e.g. the org index). */
  exact?: boolean;
  /**
   * Omit this destination unless the viewer is an installation administrator.
   *
   * Set it when EVERY procedure the page calls on mount is install-scoped.
   * Otherwise the page renders for someone who cannot use it and each of its
   * queries 403s on its own, which reads as a broken app rather than a
   * permission boundary. This only omits the link; the route guards itself and
   * the server re-checks the same flag (authz/capability.ts).
   */
  installAdminOnly?: boolean;
  /**
   * Anchor for the product tour, rendered as `data-tour="<id>"`.
   *
   * Set it only on destinations the tour actually stops at. The attribute is
   * a contract with `features/tour/steps.ts`, so an unused one is dead weight
   * and a renamed one silently breaks a step (the tour skips a missing
   * element rather than stalling, so nothing throws).
   */
  tourId?: string;
}

export interface NavManifestGroup {
  /** Uppercase micro-label. Omitted for the ungrouped top items. */
  label?: string;
  /** Optional i18n key for `label`; render with `t(labelI18nKey, label)`. */
  labelI18nKey?: TranslationKey;
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
        tourId: "nav-projects",
      },
      {
        // od-u63.2 removed this slot on the reasoning that Templates is a
        // creation path, not a destination: true of an 18-entry list that
        // existed to seed the wizard. The catalog is now 54 entries across 9
        // categories with search and category filters, i.e. something you
        // browse before you know what you want, which is what a destination
        // is. Palette-only discovery does not serve that: you cannot search a
        // catalog by name when the point is that you do not know the name.
        title: "Templates",
        i18nKey: "nav.templates",
        to: "/$orgSlug/templates",
        icon: PackageIcon,
        keywords: ["gallery", "stacks", "deploy", "catalog", "marketplace"],
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
    labelI18nKey: "nav.groups.infrastructure",
    items: [
      {
        title: "Servers",
        i18nKey: "nav.servers",
        to: "/$orgSlug/servers",
        icon: ServerStack01Icon,
        tourId: "nav-servers",
        // Docker (od-u63.3), Volumes ("Raw Docker" tab) and Platform
        // (od-u63.4, "Install health" tab) all fold in here: keep every
        // surface's old search terms so the palette still finds this page.
        keywords: [
          "nodes",
          "swarm",
          "docker",
          "containers",
          "images",
          "volumes",
          "storage",
          "disk",
          "orphan",
          "platform",
          "health",
          "queues",
          "deploys",
        ],
      },
      {
        title: "Backups",
        i18nKey: "nav.backups",
        to: "/$orgSlug/backups",
        icon: DatabaseIcon,
        keywords: ["restore", "snapshot", "database", "databases", "connections"],
      },
      {
        title: "Analytics",
        i18nKey: "nav.analytics",
        to: "/$orgSlug/analytics",
        icon: Analytics01Icon,
        keywords: [
          "traffic",
          "visitors",
          "pageviews",
          "requests",
          "referrers",
          "countries",
          "bandwidth",
          "latency",
        ],
      },
      {
        title: "Edge",
        i18nKey: "nav.edge",
        to: "/$orgSlug/edge",
        icon: EarthIcon,
        tourId: "nav-edge",
        // Networking, Edge logs and Settings → Certificates all folded in as
        // tabs (od-u63.1): keep every surface's old search terms so the
        // palette still finds this from any of their names.
        keywords: [
          "domains",
          "routes",
          "caddy",
          "caddyfile",
          "access",
          "traffic",
          "firewall",
          "crowdsec",
          "blocklist",
          "ip",
          "tls",
          "ssl",
          "certificates",
          "certs",
        ],
      },
      // Audit folds in here rather than keeping its own single-item
      // "Observability" group now that Platform is gone (od-u63.4). One
      // less group heading for one destination reads calmer.
      {
        title: "Audit",
        i18nKey: "nav.audit",
        to: "/$orgSlug/audit",
        icon: File01Icon,
        keywords: ["activity", "history"],
      },
    ],
  },
  {
    // The outbound connections a deployment runs on: where code is pulled from,
    // where images are pulled from, and the keys used to reach both plus the
    // swarm nodes. These lived in Settings → Workspace, which framed them as
    // one-time configuration; they are operating surfaces you return to
    // (connect a repo, add a registry, rotate a key), so they belong in the
    // shell next to the things they serve. API keys stayed behind: that is
    // programmatic access to otterdeploy itself, not something a deploy uses.
    label: "Workspace",
    labelI18nKey: "nav.groups.workspace",
    items: [
      {
        title: "Git providers",
        i18nKey: "nav.gitProviders",
        to: "/$orgSlug/git-providers",
        icon: GitBranchIcon,
        keywords: ["github", "gitlab", "gitea", "bitbucket", "source", "repo", "connection"],
      },
      {
        title: "Registries",
        i18nKey: "nav.registries",
        to: "/$orgSlug/registries",
        icon: Database02Icon,
        keywords: ["docker", "image", "ghcr", "ecr", "pull", "credentials"],
      },
      {
        title: "SSH keys",
        i18nKey: "nav.sshKeys",
        to: "/$orgSlug/ssh-keys",
        icon: Key01Icon,
        keywords: ["deploy key", "git", "node", "credentials", "keypair"],
      },
      {
        // Same reasoning as its neighbours: routing an event to a channel is
        // something you come back to (add a channel, mute a noisy event, check
        // a failed delivery), not one-time setup. Moved out of
        // Settings → Workspace.
        title: "Notifications",
        i18nKey: "nav.notifications",
        to: "/$orgSlug/notifications",
        icon: BellDotIcon,
        keywords: ["alerts", "slack", "discord", "email", "webhook", "telegram", "pagerduty"],
      },
    ],
  },
];

/**
 * Destinations reachable from the palette and by deep link but deliberately
 * absent from the sidebar: creation paths rather than places you "go"
 * (od-u63.2). Merged into the palette's first group; see `ORG_NAV_GROUPS` in
 * `command-palette/components/nav-items.tsx`.
 *
 * Empty since Templates graduated to a real sidebar slot. Kept because the
 * seam is the useful part: the next creation path that needs palette reach
 * without a sidebar row belongs here, and the palette already spreads it.
 */
export const PALETTE_EXTRA_NAV: readonly NavManifestItem[] = [];

/** Pinned entry at the bottom of the operational sidebar: enters the zone. */
export const SETTINGS_ENTRY: NavManifestItem = {
  title: "Settings",
  i18nKey: "nav.settings",
  to: "/$orgSlug/settings",
  icon: Settings01Icon,
  keywords: ["preferences", "configuration", "workspace", "instance", "account"],
};

// ─── Settings zone ───────────────────────────────────────────────────
//
// Lives in ./settings-nav, re-exported so this module stays the one place
// navigation is imported from.
export { SETTINGS_NAV, type SettingsNavGroup } from "./settings-nav";
