/**
 * Resolve the configured off-host audit-export destination from env, if
 * any. Returns `null` when nothing is configured — callers (the cron job)
 * treat that as a clean no-op, not an error: audit export is opt-in.
 */
import type { AuditExportDestination } from "./destination";

import { env } from "@otterdeploy/env/server";

import { createLocalExportDestination } from "./local";
import { createS3ExportDestination } from "./s3";

export interface AuditExportConfig {
  destination: AuditExportDestination;
  retentionDays: number;
  /** Key prefix every export batch/manifest is written under — also the
   *  prefix retention lists to find what it may delete. */
  keyPrefix: string;
}

export function resolveAuditExportConfig(): AuditExportConfig | null {
  const keyPrefix = "audit-export/";
  // S3 takes priority when both are configured — see packages/env doc
  // comment on AUDIT_EXPORT_*.
  if (env.AUDIT_EXPORT_S3_BUCKET) {
    if (!env.AUDIT_EXPORT_S3_ACCESS_KEY_ID || !env.AUDIT_EXPORT_S3_SECRET_ACCESS_KEY) {
      throw new Error(
        "AUDIT_EXPORT_S3_BUCKET is set but AUDIT_EXPORT_S3_ACCESS_KEY_ID/AUDIT_EXPORT_S3_SECRET_ACCESS_KEY are missing",
      );
    }
    const destination = createS3ExportDestination({
      bucket: env.AUDIT_EXPORT_S3_BUCKET,
      region: env.AUDIT_EXPORT_S3_REGION,
      endpoint: env.AUDIT_EXPORT_S3_ENDPOINT,
      accessKeyId: env.AUDIT_EXPORT_S3_ACCESS_KEY_ID,
      secretAccessKey: env.AUDIT_EXPORT_S3_SECRET_ACCESS_KEY,
    });
    return {
      destination,
      retentionDays: env.AUDIT_EXPORT_RETENTION_DAYS,
      keyPrefix: env.AUDIT_EXPORT_S3_PREFIX
        ? `${env.AUDIT_EXPORT_S3_PREFIX.replace(/\/+$/, "")}/${keyPrefix}`
        : keyPrefix,
    };
  }
  if (env.AUDIT_EXPORT_LOCAL_DIR) {
    return {
      destination: createLocalExportDestination(env.AUDIT_EXPORT_LOCAL_DIR),
      retentionDays: env.AUDIT_EXPORT_RETENTION_DAYS,
      keyPrefix,
    };
  }
  return null;
}
