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
  BellDotIcon,
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
      // No "Templates" slot (od-u63.2) — it's a creation path (the + New
      // service wizard's "From template" source), not a destination. The
      // gallery page + its palette entry stay reachable via PALETTE_EXTRA_NAV.
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
        // Docker (od-u63.3), Volumes ("Raw Docker" tab) and Platform
        // (od-u63.4, "Install health" tab) all fold in here — keep every
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
        to: "/$orgSlug/backups",
        icon: DatabaseIcon,
        keywords: ["restore", "snapshot", "database", "databases", "connections"],
      },
      {
        title: "Edge",
        to: "/$orgSlug/edge",
        icon: EarthIcon,
        // Networking, Edge logs and Settings → Certificates all folded in as
        // tabs (od-u63.1) — keep every surface's old search terms so the
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
      // "Observability" group now that Platform is gone (od-u63.4) — one
      // less group heading for one destination reads calmer.
      {
        title: "Audit",
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
    items: [
      {
        title: "Git providers",
        to: "/$orgSlug/git-providers",
        icon: GitBranchIcon,
        keywords: ["github", "gitlab", "gitea", "bitbucket", "source", "repo", "connection"],
      },
      {
        title: "Registries",
        to: "/$orgSlug/registries",
        icon: Database02Icon,
        keywords: ["docker", "image", "ghcr", "ecr", "pull", "credentials"],
      },
      {
        title: "SSH keys",
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
        to: "/$orgSlug/notifications",
        icon: BellDotIcon,
        keywords: ["alerts", "slack", "discord", "email", "webhook", "telegram", "pagerduty"],
      },
    ],
  },
];

/**
 * Destinations that are reachable (palette, deep link) but intentionally NOT
 * sidebar slots — creation paths rather than places you "go" (od-u63.2).
 * Merged into the palette only; see `ORG_NAV_GROUPS` in
 * `command-palette/components/nav-items.tsx`.
 */
export const PALETTE_EXTRA_NAV: readonly NavManifestItem[] = [
  {
    title: "Templates",
    to: "/$orgSlug/templates",
    icon: PackageIcon,
    keywords: ["gallery", "stacks", "deploy", "catalog"],
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
        // Label-only rename (od-u63.7) — path is unchanged. "General" was
        // ambiguous with Instance → General; this page is base domain +
        // Cloudflare, so "Domains" says what it actually does.
        title: "Domains",
        to: "/$orgSlug/settings/workspace/general",
        icon: Settings01Icon,
        keywords: ["domain", "cloudflare", "workspace settings", "general"],
      },
      {
        title: "Team",
        to: "/$orgSlug/settings/workspace/team",
        icon: UserMultipleIcon,
        keywords: ["members", "invite"],
      },
      // Git providers, Registries and SSH keys moved to the operational
      // sidebar's Workspace group — see OPERATIONAL_NAV above. The settings
      // paths remain as redirect shims, so old bookmarks still land.
      {
        title: "Single sign-on",
        to: "/$orgSlug/settings/workspace/sso",
        icon: ShieldKeyIcon,
        keywords: ["sso", "saml", "oidc", "okta", "entra", "azure", "identity provider", "idp"],
      },
      {
        title: "API keys",
        to: "/$orgSlug/settings/workspace/api-keys",
        icon: Key02Icon,
        keywords: ["tokens", "access"],
      },
      {
        title: "Webhooks",
        to: "/$orgSlug/settings/workspace/webhooks",
        icon: WebhookIcon,
        keywords: ["hmac", "deliveries", "inbound", "events"],
      },
      // Notifications moved to OPERATIONAL_NAV → Workspace; the old settings
      // path now redirects there. Its transport cards (email provider, Twilio,
      // FCM) were removed outright — per-channel delivery credentials are
      // captured by the channel dialog itself.
    ],
  },
  {
    label: "Instance",
    items: [
      {
        // Label-only rename (od-u63.7) — path is unchanged. No page should be
        // named "General" twice in the same rail; "Instance" says whose
        // config this is (install-wide, not workspace-scoped).
        title: "Instance",
        to: "/$orgSlug/settings/instance/general",
        icon: ServerStack01Icon,
        keywords: [
          "instance",
          "platform",
          "server ip",
          "control plane",
          "acme",
          "updates",
          "general",
        ],
      },
    ],
  },
];
