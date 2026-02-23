import { createLogger } from "@otterdeploy/logger";

import { inngest } from "../inngest";

const logger = createLogger("domain-verification");

export const domainVerification = inngest.createFunction(
  {
    id: "domain-verification",
    retries: 3,
  },
  { event: "domain.added" },
  async ({ event, step }) => {
    const { domainId, orgId, domain } = event.data;

    // Wait 30 seconds for DNS propagation
    await step.sleep("wait-for-dns", "30s");

    // Attempt verification
    const verificationResult = await step.run("verify-domain", async () => {
      const { verifyDomainFull } = await import(
        "@otterdeploy/domain/custom-domain"
      );

      // For now, use a placeholder — in production this comes from the server record
      const serverIp = "0.0.0.0";

      const result = await verifyDomainFull(domainId, orgId, serverIp);
      if (result.isErr()) throw result.error;
      return result.value;
    });

    if (verificationResult.verified) {
      logger.info({ domainId, domain }, "Domain verified successfully");
    } else {
      logger.info(
        { domainId, domain },
        "Domain verification pending — TXT record not found",
      );
    }

    return verificationResult;
  },
);
