import * as z from "zod";

export const IdSchema = z.string().min(1);
export const SlugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const PageSchema = z.number().int().min(1);
export const PageSizeSchema = z.number().int().min(1).max(100);

export const PaginatedInputSchema = z.object({
  page: PageSchema.optional().default(1),
  pageSize: PageSizeSchema.optional().default(10),
});

export const PaginationMetaSchema = z.object({
  pagination: z.object({
    page: z.number(),
    pageSize: z.number(),
    pageCount: z.number(),
    total: z.number(),
  }),
});

export const createPaginatedOutputSchema = <TItem extends z.ZodTypeAny>(item: TItem) =>
  z.object({
    items: z.array(item),
    meta: PaginationMetaSchema,
  });

export const TimestampsSchema = z.object({
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const ResourceKindSchema = z.enum(["web", "api", "worker", "database", "cache", "volume"]);
export const ResourceStatusSchema = z.enum([
  "online",
  "degraded",
  "crashed",
  "unknown",
  "deploying",
  "stopped",
]);
export const ResourceLinkTypeSchema = z.enum(["depends_on", "network", "mounts"]);

export const DeploymentStatusSchema = z.enum([
  "queued",
  "building",
  "deploying",
  "verifying",
  "live",
  "failed",
  "canceled",
  "rolled_back",
]);

export const DeploymentSourceSchema = z.enum(["git_push", "manual", "rollback", "api", "preview"]);
export const BuildMethodSchema = z.enum(["nixpacks", "dockerfile", "buildpack"]);
export const BuilderSchema = z.enum(["nixpacks", "dockerfile", "buildpack", "railpack"]);
export const RestartPolicySchema = z.enum(["ON_FAILURE", "ALWAYS", "NEVER"]);
export const OrgRoleSchema = z.enum(["owner", "admin", "member", "viewer"]);
export const EnvVarScopeSchema = z.enum(["project", "environment", "resource"]);
export const SecretProviderSchema = z.enum(["infisical", "native_breakglass"]);
export const SecretKindSchema = z.enum([
  "env_var",
  "ssh_private_key",
  "git_client_secret",
  "git_webhook_secret",
]);
export const SecretLogicalScopeSchema = z.enum([
  "organization",
  "project",
  "environment",
  "resource",
]);

export const ErrorCodeSchema = z.enum([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "BAD_REQUEST",
  "TOO_MANY_REQUESTS",
  "INTERNAL",
]);

export const SuccessSchema = z.object({
  success: z.literal(true),
});
