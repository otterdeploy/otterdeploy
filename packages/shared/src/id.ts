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
  user: "usr",
  session: "sess",
  account: "acct",
  verification: "vrf",
  // organizations
  organization: "org",
  member: "mbr",
  invitation: "inv",
  // api keys (better-auth apiKey plugin — table name is `apikey`)
  apiKey: "ak",
  project: "prj",
  resource: "res",
  deployment: "dep",
  servicePort: "port",
  serviceMount: "mnt",
  serviceEnvVar: "senv",
  projectEnvVar: "penv",
  projectEnvSubscription: "psub",
  environment: "env",
  preview: "prev",
  proxyRoute: "rt",
  deploymentGuest: "gst",
  server: "srv",
  nodeEnrollment: "enr",
  // workspace: "workspace",
  workspace: "wksp",
  // git source connections
  gitProvider: "gitp",
  gitInstallation: "giti",
  gitRepo: "gitr",
  // build pipeline
  containerRegistry: "reg",
  deploymentLog: "dlog",
  // backups
  backup: "bak",
  backupSchedule: "bsch",
  backupDestination: "bdst",
  backupLog: "blog",
  // audit trail
  auditLog: "aud",
  // in-app notifications
  notification: "ntf",
  // notification channels (routing config + delivery log)
  notificationChannel: "ntfc",
  notificationSubscription: "ntfs",
  notificationDelivery: "ntfd",
  // firewall — managed IP blocklists synced into CrowdSec
  blocklist: "blk",
  // SSH keys — org-scoped keypairs for Git auth + node management
  sshKey: "ssh",
  // TLS — operator-uploaded custom certificates + trusted CA inventory
  customCertificate: "cert",
  trustedCa: "ca",
  // ephemeral database credentials — short-lived, auto-disposed DB roles
  databaseEphemeralCredential: "dbeph",
  // webhooks — outbound event subscriptions + delivery log + inbound trigger
  // endpoints
  webhook: "wh",
  webhookDelivery: "whd",
  inboundEndpoint: "inhk",
  // orphaned remote resources awaiting GC (teardown couldn't reach the daemon)
  orphanedResource: "orph",
  // private networking — the org's connected VPN/mesh account (NetBird,
  // Tailscale). One row per org. Design: docs/designs/vpn-mesh.md
  meshNetwork: "mesh",
} as const;

export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX];

/**
 * The prefix each entity used BEFORE they were shortened, for the entities
 * that changed.
 *
 * The database rows were rewritten in place by
 * `packages/db/scripts/shorten-id-prefixes.sql`. This table remains because
 * plenty of long-form IDs live where that migration could not reach:
 *
 *  - Docker labels (`otterdeploy.resource.id`), fixed at container creation and
 *    only replaced when the container is recreated.
 *  - IDs inside stored JSON — deployment snapshots, audit payloads, manifests.
 *  - Bookmarked URLs and already-open browser tabs.
 *
 * `zId` translates those to the current spelling via `canonicalId` on the way
 * in, so callers downstream only ever see the short form.
 *
 * `createId` only ever mints the SHORT form. An entity absent from this map
 * never changed prefix.
 */
export const LEGACY_ID_PREFIX = {
  account: "account",
  apiKey: "apikey",
  auditLog: "audit",
  backupDestination: "bakdest",
  backupSchedule: "baksched",
  blocklist: "blocklist",
  containerRegistry: "regcred",
  deployment: "deployment",
  deploymentGuest: "guest",
  gitInstallation: "gitinst",
  gitProvider: "gitprov",
  gitRepo: "gitrepo",
  invitation: "invite",
  member: "member",
  nodeEnrollment: "enroll",
  notification: "notif",
  notificationChannel: "notifchan",
  notificationDelivery: "notifdlv",
  notificationSubscription: "notifsub",
  orphanedResource: "orphres",
  project: "project",
  proxyRoute: "proxy_route",
  resource: "resource",
  server: "server",
  session: "session",
  sshKey: "sshkey",
  user: "user",
  verification: "verification",
  webhookDelivery: "whdlv",
} as const satisfies Partial<Record<keyof typeof ID_PREFIX, string>>;

/** Old spelling for a current prefix, when it had one. */
function legacyFor(prefix: IdPrefix): string | null {
  for (const [key, current] of Object.entries(ID_PREFIX)) {
    if (current !== prefix) continue;
    const old = (LEGACY_ID_PREFIX as Record<string, string | undefined>)[key];
    return old ?? null;
  }
  return null;
}

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
  if (id.startsWith(`${prefix}_`)) return true;
  // An ID minted before the prefixes were shortened is still that entity.
  const legacy = legacyFor(prefix as IdPrefix);
  return legacy != null && id.startsWith(`${legacy}_`);
}

/**
 * Reverse of LEGACY_ID_PREFIX -- old spelling to current one, longest first.
 *
 * Longest first because one old prefix (`proxy_route`) contains an underscore,
 * so a plain split on the first `_` would read it as `proxy` and miss it. That
 * is the same trap that had `idPrefix("proxy_route_...")` returning `proxy`.
 */
const CURRENT_FOR_LEGACY: ReadonlyArray<readonly [string, string]> = Object.entries(
  LEGACY_ID_PREFIX,
)
  .map(([key, old]) => [old, ID_PREFIX[key as keyof typeof ID_PREFIX]] as const)
  .sort(([a], [b]) => b.length - a.length);

/**
 * Rewrite an ID minted before the prefixes were shortened into its current
 * spelling. Anything already current, or carrying no prefix we know, is
 * returned untouched.
 *
 * Needed wherever an ID arrives from somewhere the migration could not reach.
 * Docker labels are the case that matters: `otterdeploy.resource.id` is stamped
 * when a container is created and is immutable thereafter, so every container
 * running from before the rename still reports the long form. The metrics
 * sampler keys rows on that label, so without this the samples land under an
 * ID no resource has and quietly vanish from that resource's charts.
 */
export function canonicalId(id: string): string {
  for (const [old, current] of CURRENT_FOR_LEGACY) {
    if (id.startsWith(`${old}_`)) return `${current}${id.slice(old.length)}`;
  }
  return id;
}

/**
 * Zod schema for a branded, prefixed ID.
 *
 * Validates at runtime that the string starts with the expected prefix
 * and outputs `Id<P>` (which extends `string`, so it works with Drizzle).
 *
 * @example
 *   z.object({ projectId: zId("prj") })
 */
export function zId<P extends IdPrefix>(
  prefix: P,
): z.ZodPipe<z.ZodString, z.ZodTransform<Id<P>, string>> {
  const legacy = legacyFor(prefix);
  // Accept the pre-shortening spelling too — see LEGACY_ID_PREFIX. Anchored and
  // built from a fixed table, never from user input, so there is nothing to
  // escape.
  const pattern = legacy ? `^(?:${prefix}|${legacy})_` : `^${prefix}_`;
  const expected = legacy ? `"${prefix}_" (or legacy "${legacy}_")` : `"${prefix}_"`;
  return (
    z
      .string()
      .regex(new RegExp(pattern), `ID must start with ${expected}`)
      // Rewrite to the current spelling here, at the edge, so nothing downstream
      // has to know the old one existed. Accepting a legacy ID without
      // translating it would only move the failure: it passes validation and then
      // matches no row, which is what a bookmarked URL or an already-open tab
      // sends after the prefixes were shortened.
      .transform((s) => canonicalId(s) as Id<P>)
  );
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
export type NodeEnrollmentId = Id<typeof ID_PREFIX.nodeEnrollment>;
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

export type OrphanedResourceId = Id<typeof ID_PREFIX.orphanedResource>;

// Private networking (NetBird / Tailscale) — docs/designs/vpn-mesh.md
export type MeshNetworkId = Id<typeof ID_PREFIX.meshNetwork>;

// Notification channels
export type NotificationChannelId = Id<typeof ID_PREFIX.notificationChannel>;
export type NotificationSubscriptionId = Id<typeof ID_PREFIX.notificationSubscription>;
export type NotificationDeliveryId = Id<typeof ID_PREFIX.notificationDelivery>;

// Slugs (URL-safe identifiers, distinct from cuid IDs)
export type ProjectSlug = Slug<typeof ID_PREFIX.project>;
export type EnvironmentSlug = Slug<typeof ID_PREFIX.environment>;
// Back-compat alias — pre-existing callsites import `EnvSlug`.
export type EnvSlug = EnvironmentSlug;
