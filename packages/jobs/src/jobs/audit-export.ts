import * as z from "zod";

import { resolveAuditExportConfig } from "../audit-export/config";
import { runAuditExport } from "../audit-export/export";
import { runAuditExportRetention } from "../audit-export/retention";
import { defineJob } from "../define";

/**
 * Off-host audit export + retention (od-5j8.21). Runs every 15 minutes —
 * frequent enough that under normal operation every mutation/denial row is
 * shipped off-host well within the DB's own 90-day retention window
 * (hourly-cleanup.ts), so a destination outage has a wide margin to recover
 * in before the DB purge could outrun the export.
 *
 * A clean no-op when no destination is configured (`resolveAuditExportConfig`
 * returns `null`) — audit export is opt-in, and self-hosters who haven't set
 * any `AUDIT_EXPORT_*` var should see this job do nothing, not fail.
 */
export const auditExportJob = defineJob({
  name: "cron.audit-export",
  schema: z.object({}).optional().default({}),
  cron: { pattern: "*/15 * * * *" },
  opts: {
    removeOnComplete: { age: 60 * 60 * 24 * 3 },
    removeOnFail: { age: 60 * 60 * 24 * 14 },
  },
  async handler(_payload, { log }) {
    const config = resolveAuditExportConfig();
    if (!config) {
      log.info({ auditExport: { step: "skipped", reason: "no destination configured" } });
      return { skipped: true };
    }

    const { totalExported, batches } = await runAuditExport(config);
    log.info({
      auditExport: {
        step: "exported",
        destination: config.destination.kind,
        totalExported,
        batchCount: batches.length,
      },
    });

    const retention = await runAuditExportRetention(config);
    if (retention.deleted.length > 0) {
      log.info({
        auditExport: { step: "retention", destination: config.destination.kind, deleted: retention.deleted.length },
      });
    }

    return { totalExported, batches: batches.length, retentionDeleted: retention.deleted.length };
  },
});
