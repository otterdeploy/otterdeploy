/**
 * Branded, prefixed ID generation for otterdeploy entities.
 *
 * Every table uses a human-readable prefix so you can identify the entity
 * type from the ID alone (e.g. "project_clx1abc...", "resource_clx2def...").
 *
 * Usage:
 *   import { createId, ID_PREFIX, type ProjectId } from "@otterdeploy/shared/id";
 *   const id = createId("project");        // "project_clx1abc2def3ghi"
 *   const id = createId(ID_PREFIX.project); // same, but autocompleted
 *
 * Prefer the named brand aliases (`ProjectId`, `ResourceId`, …) over the
 * verbose generic form (`Id<typeof ID_PREFIX.project>`) at callsites.
 */

import { createId as cuid } from "@paralleldrive/cuid2";
import * as z from "zod";

// ---------------------------------------------------------------------------
// Prefix registry — add new prefixes here as tables are created
// ---------------------------------------------------------------------------

export const ID_PREFIX = {
  // auth
  user: "user",
  session: "session",
  account: "account",
  verification: "verification",
  // organizations
  organization: "org",
  member: "member",
  invitation: "invite",
  // api keys (better-auth apiKey plugin — table name is `apikey`)
  apiKey: "apikey",

  project: "project",
  resource: "resource",
  deployment: "deployment",
  servicePort: "port",
  serviceMount: "mnt",
  serviceEnvVar: "senv",
  projectEnvVar: "penv",
  projectEnvSubscription: "psub",
  environment: "env",
  preview: "prev",
  proxyRoute: "proxy_route",
  deploymentGuest: "guest",
  server: "server",
  // workspace: "workspace",
  workspace: "wksp",

  // git source connections
  gitProvider: "gitprov",
  gitInstallation: "gitinst",
  gitRepo: "gitrepo",

  // build pipeline
  containerRegistry: "regcred",
  deploymentLog: "dlog",

  // backups
  backup: "bak",
  backupSchedule: "baksched",
  backupDestination: "bakdest",
  backupLog: "blog",

  // audit trail
  auditLog: "audit",

  // in-app notifications
  notification: "notif",

  // notification channels (routing config + delivery log)
  notificationChannel: "notifchan",
  notificationSubscription: "notifsub",
  notificationDelivery: "notifdlv",

  // firewall — managed IP blocklists synced into CrowdSec
  blocklist: "blocklist",

  // SSH keys — org-scoped keypairs for Git auth + node management
  sshKey: "sshkey",

  // TLS — operator-uploaded custom certificates + trusted CA inventory
  customCertificate: "cert",
  trustedCa: "ca",

  // ephemeral database credentials — short-lived, auto-disposed DB roles
  databaseEphemeralCredential: "dbeph",

  // webhooks — outbound event subscriptions + delivery log + inbound trigger
  // endpoints
  webhook: "wh",
  webhookDelivery: "whdlv",
  inboundEndpoint: "inhk",
} as const;

export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX];

/**
 * Branded string ID with a known prefix.
 *
 * Uses a plain property-name brand (`__brand`) rather than a `unique symbol`.
 * A unique-symbol brand trips TS4023/TS4058 ("cannot be named '__brand'") the
 * moment a consumer emits a type that references `Id<P>` (e.g. an oRPC
 * router's inferred output) — the emitted declaration has to name a symbol it
 * isn't allowed to see, so the branded input/output types stop lining up and
 * callers are forced to launder plain strings through `as never`. A plain
 * property name is always nameable across module boundaries, so it survives
 * declaration emission. Same level of safety: a plain string can't satisfy
 * `Id<P>` without a cast.
 */
export type Id<P extends string = string> = string & {
  readonly __brand: P;
};

/**
 * Create a prefixed, collision-resistant unique ID using cuid2.
 *
 * Format: `{prefix}_{cuid2}`
 */
export function createId<P extends IdPrefix>(prefix: P): Id<P> {
  return `${prefix}_${cuid()}` as Id<P>;
}

/**
 * Extract the prefix from a branded ID.
 *
 * @example
 *   idPrefix("project_clx1abc2def3ghi") // "project"
 */
export function idPrefix(id: string): string | null {
  const idx = id.indexOf("_");
  if (idx === -1) return null;
  return id.slice(0, idx);
}

/**
 * Check if an ID has a specific prefix.
 *
 * @example
 *   hasPrefix("project_clx1abc", "project") // true
 */
export function hasPrefix<P extends string>(id: string, prefix: P): id is Id<P> {
  return id.startsWith(`${prefix}_`);
}

/**
 * Zod schema for a branded, prefixed ID.
 *
 * Validates at runtime that the string starts with the expected prefix
 * and outputs `Id<P>` (which extends `string`, so it works with Drizzle).
 *
 * @example
 *   z.object({ projectId: zId("project") })
 */
export function zId<P extends IdPrefix>(
  prefix: P,
): z.ZodPipe<z.ZodString, z.ZodTransform<Id<P>, string>> {
  return z
    .string()
    .regex(new RegExp(`^${prefix}_`), `ID must start with "${prefix}_"`)
    .transform((s) => s as Id<P>);
}

/** Per-entity zId schema, keyed by `ID_PREFIX` name. */
type IdSchemaMap = {
  [K in keyof typeof ID_PREFIX]: ReturnType<typeof zId<(typeof ID_PREFIX)[K]>>;
};

/**
 * Branded-ID validators keyed by entity name — the ergonomic entry point for
 * branding an untrusted string at a boundary (route `validateSearch`/`params`,
 * a form field, a raw query param). `string` in, `Id<P>` out.
 *
 * @example
 *   // TanStack route: the param comes out already branded.
 *   validateSearch: z.object({ id: idSchema.project })   // → ProjectId
 */
export const idSchema = Object.fromEntries(
  Object.entries(ID_PREFIX).map(([key, prefix]) => [key, zId(prefix as IdPrefix)]),
) as IdSchemaMap;

/**
 * Branded id types keyed by entity name, derived from {@link idSchema}:
 * `BrandedIds["project"]` is exactly the output of `idSchema.project`. Handy
 * when you want the branded type without importing the per-entity alias.
 */
export type BrandedIds = {
  [K in keyof typeof ID_PREFIX]: z.infer<IdSchemaMap[K]>;
};

/**
 * Branded string slug. URL-safe identifier scoped to an entity kind
 * (e.g. `Slug<"project">` for project slugs, `Slug<"env">` for env slugs).
 *
 * Same plain-property-brand pattern as `Id<P>` so it survives .d.ts emit.
 */
export type Slug<P extends string = string> = string & {
  readonly __slug: P;
};

/**
 * Zod validator that normalizes any string into a slug (lowercase, trimmed,
 * dashes only) and brands it for the given entity kind. The runtime check is
 * `.slugify().min(2).max(48)` — the brand is compile-time only.
 *
 * @example
 *   z.object({ slug: zSlug("project") })
 */
export function zSlug<P extends string>(brand: P) {
  // The `brand` arg is type-only at runtime — it just narrows the resulting
  // Slug<P> generic so TS distinguishes Slug<"project"> from Slug<"env">.
  void brand;
  return z
    .string()
    .slugify()
    .min(2)
    .max(48)
    .transform((s) => s as Slug<P>);
}

// ---------------------------------------------------------------------------
// Named brand aliases — one per ID_PREFIX entry, plus slug variants where
// they exist. Consumers should prefer these (`ProjectId`) over the verbose
// inline `Id<typeof ID_PREFIX.project>` form. The generic primitives above
// are still exported for cases where the prefix is dynamic (rare).
// ---------------------------------------------------------------------------

// Auth
export type UserId = Id<typeof ID_PREFIX.user>;
export type SessionId = Id<typeof ID_PREFIX.session>;
export type AccountId = Id<typeof ID_PREFIX.account>;
export type VerificationId = Id<typeof ID_PREFIX.verification>;

// Organizations
export type OrganizationId = Id<typeof ID_PREFIX.organization>;
export type MemberId = Id<typeof ID_PREFIX.member>;
export type InvitationId = Id<typeof ID_PREFIX.invitation>;

// Project graph
export type ProjectId = Id<typeof ID_PREFIX.project>;
export type ResourceId = Id<typeof ID_PREFIX.resource>;
export type DeploymentId = Id<typeof ID_PREFIX.deployment>;
export type ServicePortId = Id<typeof ID_PREFIX.servicePort>;
export type ServiceMountId = Id<typeof ID_PREFIX.serviceMount>;
export type ServiceEnvVarId = Id<typeof ID_PREFIX.serviceEnvVar>;
export type ProjectEnvVarId = Id<typeof ID_PREFIX.projectEnvVar>;
export type ProjectEnvSubscriptionId = Id<typeof ID_PREFIX.projectEnvSubscription>;
export type EnvironmentId = Id<typeof ID_PREFIX.environment>;
export type PreviewId = Id<typeof ID_PREFIX.preview>;
export type ProxyRouteId = Id<typeof ID_PREFIX.proxyRoute>;
export type DeploymentGuestId = Id<typeof ID_PREFIX.deploymentGuest>;
export type ServerId = Id<typeof ID_PREFIX.server>;
export type WorkspaceId = Id<typeof ID_PREFIX.workspace>;

// Git source
export type GitProviderId = Id<typeof ID_PREFIX.gitProvider>;
export type GitInstallationId = Id<typeof ID_PREFIX.gitInstallation>;

export type GitRepoId = Id<typeof ID_PREFIX.gitRepo>;

// Build pipeline
export type ContainerRegistryId = Id<typeof ID_PREFIX.containerRegistry>;
export type DeploymentLogId = Id<typeof ID_PREFIX.deploymentLog>;

// Backups
export type BackupId = Id<typeof ID_PREFIX.backup>;
export type BackupScheduleId = Id<typeof ID_PREFIX.backupSchedule>;
export type BackupDestinationId = Id<typeof ID_PREFIX.backupDestination>;
export type BackupLogId = Id<typeof ID_PREFIX.backupLog>;

export type AuditLogId = Id<typeof ID_PREFIX.auditLog>;
export type BlocklistId = Id<typeof ID_PREFIX.blocklist>;
export type SshKeyId = Id<typeof ID_PREFIX.sshKey>;
export type CustomCertificateId = Id<typeof ID_PREFIX.customCertificate>;
export type TrustedCaId = Id<typeof ID_PREFIX.trustedCa>;
export type DatabaseEphemeralCredentialId = Id<typeof ID_PREFIX.databaseEphemeralCredential>;

export type NotificationId = Id<typeof ID_PREFIX.notification>;

// Webhooks
export type WebhookId = Id<typeof ID_PREFIX.webhook>;
export type WebhookDeliveryId = Id<typeof ID_PREFIX.webhookDelivery>;
export type InboundEndpointId = Id<typeof ID_PREFIX.inboundEndpoint>;

// Notification channels
export type NotificationChannelId = Id<typeof ID_PREFIX.notificationChannel>;
export type NotificationSubscriptionId = Id<typeof ID_PREFIX.notificationSubscription>;
export type NotificationDeliveryId = Id<typeof ID_PREFIX.notificationDelivery>;

// Slugs (URL-safe identifiers, distinct from cuid IDs)
export type ProjectSlug = Slug<typeof ID_PREFIX.project>;
export type EnvironmentSlug = Slug<typeof ID_PREFIX.environment>;
// Back-compat alias — pre-existing callsites import `EnvSlug`.
export type EnvSlug = EnvironmentSlug;
