import * as z from "zod";

import { defineJob } from "../define";

export const hourlyCleanupJob = defineJob({
  name: "cron.hourly-cleanup",
  schema: z.object({}).optional().default({}),
  cron: { pattern: "0 * * * *" }, // every hour on the 0th minute
  opts: {
    removeOnComplete: { age: 60 * 60 * 24 * 3 },
    removeOnFail: { age: 60 * 60 * 24 * 14 },
  },
  async handler(_payload, { log }) {
    log.info({ cleanup: { step: "run" } });

    // TODO: delete expired sessions, clear stale cache entries, etc.
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return {
      cleaned: true,
      timestamp: new Date().toISOString(),
    };
  },
});
