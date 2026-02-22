import { pgEnum } from "drizzle-orm/pg-core";

export const deploymentStatusEnum = pgEnum("deployment_status", [
  "queued",
  "building",
  "deploying",
  "verifying",
  "live",
  "failed",
  "canceled",
  "rolled_back",
]);

export const deploymentSourceEnum = pgEnum("deployment_source", [
  "git_push",
  "manual",
  "rollback",
  "api",
  "preview",
]);

export const buildMethodEnum = pgEnum("build_method", [
  "nixpacks",
  "dockerfile",
  "buildpack",
]);

export const builderEnum = pgEnum("builder", [
  "nixpacks",
  "dockerfile",
  "buildpack",
  "railpack",
]);

export const restartPolicyEnum = pgEnum("restart_policy", [
  "ON_FAILURE",
  "ALWAYS",
  "NEVER",
]);

export const sslStatusEnum = pgEnum("ssl_status", [
  "pending",
  "active",
  "failed",
  "expired",
]);

export const serverStatusEnum = pgEnum("server_status", [
  "connected",
  "disconnected",
  "provisioning",
  "error",
]);

export const serverRoleEnum = pgEnum("server_role", [
  "manager",
  "worker",
]);

export const backupStatusEnum = pgEnum("backup_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const envVarScopeEnum = pgEnum("env_var_scope", [
  "project",
  "environment",
  "resource",
]);

export const databaseTypeEnum = pgEnum("database_type", [
  "postgresql",
  "mysql",
  "mariadb",
  "mongodb",
  "redis",
  "keydb",
  "dragonfly",
  "clickhouse",
]);

export const secretProviderEnum = pgEnum("secret_provider", [
  "infisical",
  "native_breakglass",
]);

export const secretKindEnum = pgEnum("secret_kind", [
  "env_var",
  "ssh_private_key",
  "git_client_secret",
  "git_webhook_secret",
]);

export const secretLogicalScopeEnum = pgEnum("secret_logical_scope", [
  "organization",
  "project",
  "environment",
  "resource",
]);

export const secretProviderBindingStatusEnum = pgEnum("secret_provider_binding_status", [
  "provisioning",
  "active",
  "error",
]);
