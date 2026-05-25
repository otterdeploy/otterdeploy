import * as z from "zod";

import { defineJob } from "../define";

export const dailyReportJob = defineJob({
  name: "cron.daily-report",
  schema: z.object({}).optional().default({}),
  cron: { pattern: "0 9 * * *", tz: "UTC" }, // 9am UTC every day
  opts: {
    removeOnComplete: { age: 60 * 60 * 24 * 7 },
    removeOnFail: { age: 60 * 60 * 24 * 30 },
  },
  async handler(_payload, { log }) {
    log.info({ report: { step: "generate" } });
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const reportData = {
      generatedAt: new Date().toISOString(),
      metrics: { users: 100, events: 500 },
    };

    // Email the report. Lazy-import to dodge circular deps with the triggers barrel.
    const { triggerEmail } = await import("../triggers");
    await triggerEmail({
      to: "admin@example.com",
      subject: "Daily Report",
      body: `Daily metrics: ${JSON.stringify(reportData.metrics)}`,
    });

    return {
      reportGenerated: true,
      timestamp: new Date().toISOString(),
    };
  },
});
