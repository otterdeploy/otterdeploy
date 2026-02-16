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
