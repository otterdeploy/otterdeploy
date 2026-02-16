import * as z from "zod";

export const IdSchema = z.string().min(1);
export const SlugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const CursorSchema = z.string().min(1);
export const LimitSchema = z.number().int().min(1).max(100);

export const PaginatedInputSchema = z.object({
  cursor: CursorSchema.optional(),
  limit: LimitSchema.optional(),
});

export const createPaginatedOutputSchema = <TItem extends z.ZodTypeAny>(item: TItem) =>
  z.object({
    items: z.array(item),
    nextCursor: CursorSchema.nullable(),
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
export const OrgRoleSchema = z.enum(["owner", "admin", "member", "viewer"]);
export const EnvVarScopeSchema = z.enum(["project", "environment", "resource"]);

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
