// ---------------------------------------------------------------------------
// 1. Branded ID
// ---------------------------------------------------------------------------

export type Id<T extends string> = T & { readonly __brand: unique symbol };

// ---------------------------------------------------------------------------
// 2. Enums (union types matching DB enums)
// ---------------------------------------------------------------------------

export type ResourceKind = "application" | "database";

export type ResourceStatus =
  | "online"
  | "degraded"
  | "crashed"
  | "deploying"
  | "stopped"
  | "unknown";

export type DeploymentStatus =
  | "queued"
  | "building"
  | "deploying"
  | "verifying"
  | "live"
  | "failed"
  | "canceled"
  | "rolled_back";

export type DeploymentSource =
  | "git_push"
  | "manual"
  | "rollback"
  | "api"
  | "config_change";

export type PreviewDeploymentStatus = "idle" | "running" | "done" | "error";

export type BuilderType = "nixpacks" | "dockerfile" | "buildpack" | "railpack";

export type DatabaseEngine =
  | "postgresql"
  | "mysql"
  | "mariadb"
  | "mongodb"
  | "redis"
  | "keydb"
  | "dragonfly"
  | "clickhouse";

export type RestartPolicy = "ON_FAILURE" | "ALWAYS" | "NEVER";

export type PortProtocol = "http" | "tcp" | "udp";

export type PortVisibility = "public" | "internal";

export type SslStatus = "pending" | "active" | "failed" | "expired";

export type ServerStatus = "connected" | "disconnected" | "provisioning" | "error";

export type ServerRole = "manager" | "worker";

export type BackupStatus = "pending" | "running" | "completed" | "failed";

export type CaddyStatus = "not_installed" | "initializing" | "running" | "stopped" | "error";

export type SecretProvider = "infisical" | "native_breakglass";

export type SecretKind = "env_var" | "ssh_private_key" | "git_client_secret" | "git_webhook_secret";

export type SecretLogicalScope = "organization" | "project" | "environment" | "resource";

export type SecretProviderBindingStatus = "provisioning" | "active" | "error";

export type MemberRole = "owner" | "admin" | "member";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type MetricKind =
  | "cpu"
  | "memory"
  | "disk"
  | "network_ingress"
  | "network_egress"
  | "latency"
  | "requests"
  | "errors";

export type ActorType = "user" | "system";

export type RedirectStatusCode = 301 | 302;
export type RedirectType = "www" | "custom";

// ---------------------------------------------------------------------------
// 3. Base Entity
// ---------------------------------------------------------------------------

export interface Entity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// 4. Organization & Auth
// ---------------------------------------------------------------------------

export interface Organization {
  id: Id<"organization">;
  name: string;
  slug: string;
  logo?: string | null;
  metadata?: string | null;
  createdAt: Date;
}

export interface User {
  id: Id<"user">;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  role?: string | null;
  banned?: boolean | null;
  twoFactorEnabled?: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationMember {
  id: string;
  organizationId: Id<"organization">;
  userId: Id<"user">;
  role: MemberRole;
  createdAt: Date;
  user?: User;
}

// ---------------------------------------------------------------------------
// 5. Project Hierarchy
// ---------------------------------------------------------------------------

export interface Project extends Entity {
  organizationId?: Id<"organization"> | null;
  ownerId: Id<"user">;
  name: string;
  slug: string;
  baseDomain?: string | null;
  deletedAt?: Date | null;
  owner?: User;
  environments?: Environment[];
}

export interface Environment extends Entity {
  projectId: Id<"project">;
  name: string;
  slug: string;
  resources?: Resource[];
  networkPolicies?: NetworkPolicy[];
  viewport?: Viewport;
}

// ---------------------------------------------------------------------------
// 6. Infrastructure
// ---------------------------------------------------------------------------

export interface Server extends Entity {
  organizationId: Id<"organization">;
  name: string;
  ipAddress: string;
  port: number;
  sshKeyId?: string | null;
  status: ServerStatus;
  role: ServerRole;
  dockerVersion?: string | null;
  os?: string | null;
  arch?: string | null;
  totalMemory?: number | null;
  totalCpu?: number | null;
  totalDisk?: number | null;
  swarmNodeId?: string | null;
  baseDomain?: string | null;
  dockerCleanupThreshold?: number | null;
  lastSeenAt?: Date | null;
  sshKey?: SshKey;
}

export interface CaddyInstance extends Entity {
  serverId: Id<"server">;
  status: CaddyStatus;
  version?: string | null;
  acmeEmail?: string | null;
  lastHealthCheckAt?: Date | null;
  errorMessage?: string | null;
}

export interface SshKey extends Entity {
  organizationId: Id<"organization">;
  name: string;
  publicKey: string;
  privateKeySecretReferenceId?: string | null;
  fingerprint: string;
}

export interface GitProvider extends Entity {
  organizationId: Id<"organization">;
  type: string;
  name: string;
  appId?: string | null;
  clientId?: string | null;
  clientSecretReferenceId?: string | null;
  installationId?: string | null;
  webhookSecretReferenceId?: string | null;
}

export interface GitRepository extends Entity {
  resourceId: Id<"resource">;
  gitProviderId: Id<"gitProvider">;
  owner: string;
  name: string;
  branch: string;
  rootDirectory?: string | null;
  autoDeploy: boolean;
  webhookId?: string | null;
  watchPaths?: string[] | null;
}

export interface ContainerRegistry extends Entity {
  organizationId: Id<"organization">;
  name: string;
  url: string;
  username?: string | null;
  passwordSecretRefId?: string | null;
  isDefault: boolean;
}

// ---------------------------------------------------------------------------
// 7. Secrets
// ---------------------------------------------------------------------------

export interface SecretProviderBinding extends Entity {
  organizationId: Id<"organization">;
  provider: SecretProvider;
  providerProjectId: string;
  providerProjectSlug: string;
  status: SecretProviderBindingStatus;
  metadata: Record<string, unknown>;
}

export interface SecretReference extends Entity {
  organizationId: Id<"organization">;
  provider: SecretProvider;
  kind: SecretKind;
  logicalScope: SecretLogicalScope;
  logicalScopeId: string;
  key: string;
  providerPath: string;
  providerKey: string;
  providerVersion?: string | null;
  lastResolvedAt?: Date | null;
}

// ---------------------------------------------------------------------------
// 8. Environment Variables
// ---------------------------------------------------------------------------

export interface EnvironmentVariable extends Entity {
  organizationId: Id<"organization">;
  projectId?: Id<"project"> | null;
  environmentId?: Id<"environment"> | null;
  resourceId?: Id<"resource"> | null;
  key: string;
  secretReferenceId?: string | null;
  encryptedValue: string;
  isBuildTime: boolean;
  isSecret: boolean;
}

// ---------------------------------------------------------------------------
// 9. Port Mappings
// ---------------------------------------------------------------------------

export interface PortMapping extends Entity {
  resourceId: Id<"resource">;
  port: number;
  protocol: PortProtocol;
  visibility: PortVisibility;
  domains?: DomainBinding[];
}

// ---------------------------------------------------------------------------
// 10. Domains
// ---------------------------------------------------------------------------

export interface RedirectRule {
  source: string;
  target: string;
  statusCode: RedirectStatusCode;
  type: RedirectType;
}

export interface DomainBinding extends Entity {
  organizationId: Id<"organization">;
  portMappingId: Id<"portMapping">;
  domain: string;
  verified: boolean;
  verificationToken?: string | null;
  sslStatus: SslStatus;
  sslExpiresAt?: Date | null;
  redirectRules?: RedirectRule[];
  portMapping?: PortMapping;
}

// ---------------------------------------------------------------------------
// 11. Network Policies
// ---------------------------------------------------------------------------

export interface NetworkPolicy extends Entity {
  environmentId: Id<"environment">;
  name: string;
  members?: NetworkPolicyMember[];
}

export interface NetworkPolicyMember {
  id: string;
  networkPolicyId: Id<"networkPolicy">;
  resourceId: Id<"resource">;
  alias?: string | null;
  createdAt: Date;
  resource?: Resource;
}

// ---------------------------------------------------------------------------
// 12. Volumes
// ---------------------------------------------------------------------------

export interface Volume extends Entity {
  organizationId: string;
  name: string;
  driver?: string | null;
  sizeGb?: number | null;
  storageClass?: string | null;
}

export interface VolumeMount {
  id: string;
  volumeId: Id<"volume">;
  resourceId: Id<"resource">;
  mountPath: string;
  readOnly?: boolean | null;
  createdAt: Date;
  volume?: Volume;
}

// ---------------------------------------------------------------------------
// 13. Resource Build Config
// ---------------------------------------------------------------------------

export interface ResourceBuildConfig extends Entity {
  resourceId: Id<"resource">;
  registryId?: string | null;
  builder?: BuilderType | null;
  dockerfilePath?: string | null;
  buildCommand?: string | null;
  watchPatterns?: string[] | null;
  rootDirectory?: string | null;
  preDeployCommand?: string | null;
}

// ---------------------------------------------------------------------------
// 14. Runtime Config
// ---------------------------------------------------------------------------

export interface ResourceRuntimeConfig extends Entity {
  resourceId: Id<"resource">;
  startCommand?: string | null;
  restartPolicy?: RestartPolicy | null;
  restartPolicyMaxRetries?: number | null;
  replicas?: number | null;
  cpuLimit?: number | null;
  memoryLimit?: number | null;
  region?: string | null;
  sleepApplication?: boolean | null;
  healthCheckPath?: string | null;
  healthCheckInterval?: number | null;
  healthCheckTimeout?: number | null;
  cronSchedule?: string | null;
  cronCommand?: string | null;
}

// ---------------------------------------------------------------------------
// 15. Database Config (discriminated union)
// ---------------------------------------------------------------------------

interface BaseDatabase {
  image: string;
  version?: string;
  persistenceEnabled?: boolean;
  backupEnabled?: boolean;
  memoryLimit?: number;
  cpuLimit?: number;
}

export interface PostgresConfig extends BaseDatabase {
  engine: "postgresql";
  databaseName: string;
  databaseUser: string;
  maxConnections?: number;
  sharedBuffers?: string;
  extensions?: string[];
}

export interface MySqlConfig extends BaseDatabase {
  engine: "mysql";
  databaseName: string;
  databaseUser: string;
  maxConnections?: number;
  innodbBufferPoolSize?: string;
}

export interface MariaDbConfig extends BaseDatabase {
  engine: "mariadb";
  databaseName: string;
  databaseUser: string;
  maxConnections?: number;
  innodbBufferPoolSize?: string;
}

export interface MongoConfig extends BaseDatabase {
  engine: "mongodb";
  databaseName: string;
  replicaSet?: string;
  wiredTigerCacheSize?: string;
}

export interface RedisConfig extends BaseDatabase {
  engine: "redis";
  maxMemory?: string;
  evictionPolicy?: "noeviction" | "allkeys-lru" | "volatile-lru" | "allkeys-random" | "volatile-random" | "volatile-ttl";
  appendOnly?: boolean;
}

export interface KeyDbConfig extends BaseDatabase {
  engine: "keydb";
  maxMemory?: string;
  evictionPolicy?: "noeviction" | "allkeys-lru" | "volatile-lru" | "allkeys-random" | "volatile-random" | "volatile-ttl";
  activeReplica?: boolean;
  multiMaster?: boolean;
}

export interface DragonflyConfig extends BaseDatabase {
  engine: "dragonfly";
  maxMemory?: string;
  cacheMode?: boolean;
}

export interface ClickHouseConfig extends BaseDatabase {
  engine: "clickhouse";
  databaseName: string;
  databaseUser: string;
  maxMemoryUsage?: string;
}

export type DatabaseConfig =
  | PostgresConfig
  | MySqlConfig
  | MariaDbConfig
  | MongoConfig
  | RedisConfig
  | KeyDbConfig
  | DragonflyConfig
  | ClickHouseConfig;

export interface DatabaseConfigRecord extends Entity {
  resourceId: Id<"resource">;
  engine: DatabaseEngine;
  config: DatabaseConfig;
}

// ---------------------------------------------------------------------------
// 16. Resources
// ---------------------------------------------------------------------------

export interface BaseResource extends Entity {
  organizationId: Id<"organization">;
  projectId: Id<"project">;
  environmentId: Id<"environment">;
  serverId?: string | null;
  kind: ResourceKind;
  name: string;
  appName: string;
  status: ResourceStatus;
  deletedAt?: Date | null;

  // Relations (optional, loaded via joins)
  runtimeConfig?: ResourceRuntimeConfig | null;
  buildConfig?: ResourceBuildConfig | null;
  databaseConfig?: DatabaseConfigRecord | null;
  position?: ResourcePosition | null;
  portMappings?: PortMapping[];
  networkPolicyMemberships?: NetworkPolicyMember[];
  domains?: DomainBinding[];
  volumeMounts?: VolumeMount[];
  variables?: EnvironmentVariable[];
  deployments?: Deployment[];
  configFiles?: ConfigFile[];
  gitRepository?: GitRepository | null;
  previewDeployments?: PreviewDeployment[];
}

export interface PreviewConfig {
  enabled: boolean;
  previewLimit?: number;
  expiresAfterHours?: number | null;
}

export interface ApplicationResource extends BaseResource {
  kind: "application";
  previewConfig?: PreviewConfig | null;
}

export interface DatabaseResource extends BaseResource {
  kind: "database";
  databaseConfig: DatabaseConfigRecord;
}

export type Resource = ApplicationResource | DatabaseResource;

// ---------------------------------------------------------------------------
// 16b. Preview Deployments
// ---------------------------------------------------------------------------

export interface PreviewDeployment extends Entity {
  applicationId: Id<"resource">;
  appName: string;
  branch: string;
  pullRequestNumber?: string | null;
  pullRequestUrl?: string | null;
  pullRequestTitle?: string | null;
  pullRequestCommentId?: string | null;
  status: PreviewDeploymentStatus;
  domainId?: Id<"domainBinding"> | null;
  expiresAt?: Date | null;
  deployments?: Deployment[];
  domain?: DomainBinding | null;
}

// ---------------------------------------------------------------------------
// 17. Deployments
// ---------------------------------------------------------------------------

export interface Deployment extends Entity {
  organizationId: string;
  projectId: Id<"project">;
  environmentId: Id<"environment">;
  resourceId: Id<"resource">;
  previewDeploymentId?: Id<"previewDeployment"> | null;
  status: DeploymentStatus;
  source: DeploymentSource;
  gitRef?: string | null;
  gitCommitSha?: string | null;
  gitCommitMessage?: string | null;
  builder?: BuilderType | null;
  imageTag?: string | null;
  previousImageTag?: string | null;
  logPath?: string | null;
  logServerId?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  finishedAt?: Date | null;
  duration?: number | null;
  errorMessage?: string | null;
  triggeredBy?: Id<"user"> | null;
  idempotencyKey?: string | null;
  events?: DeploymentEvent[];
  triggeredByUser?: User;
}

export interface DeploymentEvent {
  id: string;
  deploymentId: Id<"deployment">;
  status: DeploymentStatus;
  previousStatus?: DeploymentStatus | null;
  actor?: string | null;
  reason?: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// 18. Backups
// ---------------------------------------------------------------------------

export interface BackupSchedule extends Entity {
  organizationId: Id<"organization">;
  resourceId: Id<"resource">;
  cronExpression: string;
  enabled: boolean;
  retentionCount?: number | null;
  retentionDays?: number | null;
  retentionMaxSizeGb?: number | null;
  s3Bucket?: string | null;
  s3Region?: string | null;
  s3Endpoint?: string | null;
  s3AccessKeyRef?: string | null;
  s3SecretKeyRef?: string | null;
}

export interface Backup {
  id: string;
  organizationId: Id<"organization">;
  resourceId: Id<"resource">;
  type: string;
  status: BackupStatus;
  storageKey?: string | null;
  size?: number | null;
  checksum?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  expiresAt?: Date | null;
  errorMessage?: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// 19. Config Files
// ---------------------------------------------------------------------------

export interface ConfigFile extends Entity {
  organizationId: Id<"organization">;
  resourceId: Id<"resource">;
  filename: string;
  content: string;
  mountPath: string;
}

// ---------------------------------------------------------------------------
// 20. Notifications
// ---------------------------------------------------------------------------

export interface NotificationChannel extends Entity {
  organizationId: Id<"organization">;
  type: string;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  eventFilter?: unknown;
}

// ---------------------------------------------------------------------------
// 21. Audit Log
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  id: string;
  organizationId?: Id<"organization"> | null;
  actorType: ActorType;
  actorUserId?: Id<"user"> | null;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// 22. Logs (frontend view types, not DB tables)
// ---------------------------------------------------------------------------

export interface BaseLogEntry {
  id: string;
  projectId: Id<"project">;
  environmentId: Id<"environment">;
  resourceId: Id<"resource">;
  timestamp: Date;
  level: LogLevel;
  message: string;
  labels?: Record<string, string>;
}

export interface BuildLogEntry extends BaseLogEntry {
  kind: "build";
  deploymentId: Id<"deployment">;
  phase: "prepare" | "install" | "build" | "package" | "push";
  step?: string;
}

export interface DeployLogEntry extends BaseLogEntry {
  kind: "deploy";
  deploymentId: Id<"deployment">;
  phase:
    | "queued"
    | "provisioning"
    | "starting"
    | "healthcheck"
    | "ready"
    | "restart"
    | "rollback"
    | "terminated";
}

export interface RuntimeLogEntry extends BaseLogEntry {
  kind: "runtime";
  stream: "stdout" | "stderr";
  instanceId?: string;
}

export interface HttpLogEntry extends BaseLogEntry {
  kind: "http";
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";
  path: string;
  statusCode: number;
  durationMs: number;
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

export interface NetworkFlowLogEntry extends BaseLogEntry {
  kind: "network";
  sourceResourceId: Id<"resource">;
  destinationResourceId?: Id<"resource">;
  direction: "ingress" | "egress" | "internal";
  protocol: "tcp" | "udp" | "http" | "https" | "grpc";
  host?: string;
  port?: number;
  bytesIn?: number;
  bytesOut?: number;
  latencyMs?: number;
}

export type LogEntry =
  | BuildLogEntry
  | DeployLogEntry
  | RuntimeLogEntry
  | HttpLogEntry
  | NetworkFlowLogEntry;

// ---------------------------------------------------------------------------
// 23. Metrics (frontend view types)
// ---------------------------------------------------------------------------

export interface MetricPoint {
  timestamp: Date;
  value: number;
}

export interface MetricSeries {
  resourceId: Id<"resource">;
  kind: MetricKind;
  unit: string;
  points: MetricPoint[];
}

export interface ResourceMetricSnapshot {
  id: string;
  resourceId: Id<"resource">;
  timestamp: Date;
  cpuPercent?: number | null;
  memoryUsed?: number | null;
  memoryLimit?: number | null;
  networkRx?: number | null;
  networkTx?: number | null;
  diskRead?: number | null;
  diskWrite?: number | null;
}

// ---------------------------------------------------------------------------
// 24. Canvas
// ---------------------------------------------------------------------------

export interface ResourcePosition {
  resourceId: Id<"resource">;
  posX: number;
  posY: number;
  updatedAt: Date;
}

export interface Viewport {
  environmentId: Id<"environment">;
  x: number;
  y: number;
  zoom: number;
  updatedAt: Date;
}
