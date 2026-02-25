import { createLogger } from "@otterdeploy/logger";
import { db, eq } from "@otterdeploy/db";
import { customDomain } from "@otterdeploy/db/schema/operations";
import { updateSslStatus } from "@otterdeploy/domain/custom-domain";
import { inngest } from "../inngest";

const logger = createLogger("ssl-monitor");

export const sslMonitor = inngest.createFunction(
  {
    id: "ssl-monitor",
    retries: 2,
  },
  { cron: "0 */6 * * *" }, // Every 6 hours
  async ({ step }) => {
    await step.run("check-ssl-status", async () => {
      // Get all verified domains
      const domains = await db.query.customDomain.findMany({
        where: eq(customDomain.verified, true),
      });

      const results: Array<{
        domainId: string;
        domain: string;
        sslStatus: string;
      }> = [];

      for (const domain of domains) {
        try {
          // Check SSL certificate expiry status.
          // In production this would query Caddy's certificate store;
          // for now we track based on the stored sslExpiresAt timestamp.
          if (domain.sslExpiresAt) {
            const expiresAt = new Date(domain.sslExpiresAt);
            const now = new Date();
            const daysUntilExpiry =
              (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

            let newStatus: "active" | "expired" = "active";
            if (daysUntilExpiry <= 0) {
              newStatus = "expired";
            }

            if (domain.sslStatus !== newStatus) {
              await updateSslStatus(
                domain.id,
                domain.organizationId,
                newStatus,
              );
            }

            results.push({
              domainId: domain.id,
              domain: domain.domain,
              sslStatus: newStatus,
            });
          }
        } catch (error) {
          logger.error(
            { domainId: domain.id, err: error },
            "Failed to check SSL status",
          );
        }
      }

      logger.info({ checked: results.length }, "SSL status check complete");
      return { checked: results.length, results };
    });
  },
);
