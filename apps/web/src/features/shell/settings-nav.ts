/**
 * Settings-zone navigation — the Linear-style takeover under
 * `/$orgSlug/settings/*`: Account / Workspace / Instance.
 *
 * Split from `nav-manifest.ts` on the seam that module's own header already
 * describes: two chromes that never coexist. The operational shell and the
 * settings zone are edited independently and have no items in common, so a
 * change to one shouldn't make the other's file longer.
 *
 * Re-exported from `nav-manifest` so existing imports keep working — that
 * module stays the single entry point for navigation.
 */

import type { TranslationKey } from "@otterdeploy/i18n";

import {
  DeviceAccessIcon,
  Key02Icon,
  ServerStack01Icon,
  Settings01Icon,
  ShieldKeyIcon,
  UserCircleIcon,
  UserMultipleIcon,
  WebhookIcon,
} from "@hugeicons/core-free-icons";

import type { NavManifestItem } from "./nav-manifest";

/** Settings-zone groups. `label` is required — the rail always shows it. */
export interface SettingsNavGroup {
  label: string;
  /** Optional i18n key for `label`; render with `t(labelI18nKey, label)`. */
  labelI18nKey?: TranslationKey;
  items: readonly NavManifestItem[];
}

export const SETTINGS_NAV: readonly SettingsNavGroup[] = [
  {
    label: "Account",
    labelI18nKey: "nav.groups.account",
    items: [
      {
        title: "Profile",
        i18nKey: "nav.profile",
        to: "/$orgSlug/settings/account/profile",
        icon: UserCircleIcon,
        keywords: ["account", "avatar", "name", "email"],
      },
      {
        title: "Security",
        i18nKey: "nav.security",
        to: "/$orgSlug/settings/account/security",
        icon: ShieldKeyIcon,
        keywords: ["password", "2fa", "two-factor", "totp"],
      },
      {
        title: "Sessions",
        i18nKey: "nav.sessions",
        to: "/$orgSlug/settings/account/sessions",
        icon: DeviceAccessIcon,
        keywords: ["devices", "sign out", "cli", "revoke"],
      },
    ],
  },
  {
    label: "Workspace",
    labelI18nKey: "nav.groups.workspace",
    items: [
      {
        // Label-only rename (od-u63.7) — path is unchanged. "General" was
        // ambiguous with Instance → General; this page is base domain +
        // Cloudflare, so "Domains" says what it actually does.
        title: "Domains",
        i18nKey: "nav.domains",
        to: "/$orgSlug/settings/workspace/general",
        icon: Settings01Icon,
        keywords: ["domain", "cloudflare", "workspace settings", "general"],
      },
      {
        title: "Team",
        i18nKey: "nav.team",
        to: "/$orgSlug/settings/workspace/team",
        icon: UserMultipleIcon,
        keywords: ["members", "invite"],
      },
      // Git providers, Registries and SSH keys moved to the operational
      // sidebar's Workspace group — see OPERATIONAL_NAV above. The settings
      // paths remain as redirect shims, so old bookmarks still land.
      {
        title: "Single sign-on",
        i18nKey: "nav.sso",
        to: "/$orgSlug/settings/workspace/sso",
        icon: ShieldKeyIcon,
        keywords: ["sso", "saml", "oidc", "okta", "entra", "azure", "identity provider", "idp"],
      },
      {
        title: "API keys",
        i18nKey: "nav.apiKeys",
        to: "/$orgSlug/settings/workspace/api-keys",
        icon: Key02Icon,
        keywords: ["tokens", "access"],
      },
      {
        title: "Webhooks",
        i18nKey: "nav.webhooks",
        to: "/$orgSlug/settings/workspace/webhooks",
        icon: WebhookIcon,
        keywords: ["hmac", "deliveries", "inbound", "events"],
      },
      // Secret providers moved to OPERATIONAL_NAV → Workspace as "Secrets";
      // the old settings path redirects there.
      // Notifications moved to OPERATIONAL_NAV → Workspace; the old settings
      // path now redirects there. Its transport cards (email provider, Twilio,
      // FCM) were removed outright — per-channel delivery credentials are
      // captured by the channel dialog itself.
    ],
  },
  {
    label: "Instance",
    labelI18nKey: "nav.groups.instance",
    items: [
      {
        // Label-only rename (od-u63.7) — path is unchanged. No page should be
        // named "General" twice in the same rail; "Instance" says whose
        // config this is (install-wide, not workspace-scoped).
        title: "Instance",
        i18nKey: "nav.instance",
        to: "/$orgSlug/settings/instance/general",
        icon: ServerStack01Icon,
        // Every card on this page is backed by the platform-settings router,
        // which is install-admin in its entirety (16 of 16 procedures).
        installAdminOnly: true,
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
