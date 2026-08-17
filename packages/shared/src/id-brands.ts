/**
 * Named brand aliases: one per ID_PREFIX entry, plus slug variants where
 * they exist. Consumers should prefer these (`ProjectId`) over the verbose
 * inline `Id<typeof ID_PREFIX.project>` form. The generic primitives in
 * ./id are still exported for cases where the prefix is dynamic (rare).
 *
 * Split out of ./id (which re-exports everything here, so import paths are
 * unchanged) purely to keep that module under the line cap: this file is
 * type-only and erases at runtime.
 */

import type { Id, ID_PREFIX, Slug } from "./id";

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

// Private networking (NetBird / Tailscale): docs/designs/vpn-mesh.md
export type MeshNetworkId = Id<typeof ID_PREFIX.meshNetwork>;

// Notification channels
export type NotificationChannelId = Id<typeof ID_PREFIX.notificationChannel>;
export type NotificationSubscriptionId = Id<typeof ID_PREFIX.notificationSubscription>;
export type NotificationDeliveryId = Id<typeof ID_PREFIX.notificationDelivery>;

// Slugs (URL-safe identifiers, distinct from cuid IDs)
export type ProjectSlug = Slug<typeof ID_PREFIX.project>;
export type EnvironmentSlug = Slug<typeof ID_PREFIX.environment>;
// Back-compat alias: pre-existing callsites import `EnvSlug`.
export type EnvSlug = EnvironmentSlug;
