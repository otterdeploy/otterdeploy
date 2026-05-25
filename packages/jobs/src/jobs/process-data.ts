import { createError } from "evlog";
import * as z from "zod";

import { defineJob } from "../define";

export const DataProcessingPayload = z.object({
  dataId: z.string().min(1),
  operation: z.enum(["transform", "aggregate", "export"]),
});
export type DataProcessingPayload = z.infer<typeof DataProcessingPayload>;

/**
 * Multi-step data processing. The original Inngest version used `step.run()`
 * for validate → process → send-completion-notification. In BullMQ the same
 * shape is a Flow: this parent job orchestrates the work and emits a child
 * notification via `triggerNotification()` once processing is done.
 *
 * If steps grow in size or each one needs durable retry semantics, split into
 * a FlowProducer-based DAG (see `flows.ts`).
 */
export const processDataJob = defineJob({
  name: "data.process",
  schema: DataProcessingPayload,
  opts: {
    attempts: 2,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { age: 60 * 60 * 24 },
    removeOnFail: { age: 60 * 60 * 24 * 7 },
  },
  async handler(payload, { log }) {
    const { dataId, operation } = payload;

    // Step 1: validate
    if (!dataId) {
      throw createError({
        message: "Data ID is required",
        status: 400,
        why: "processData was enqueued with no dataId field",
      });
    }

    // Step 2: process
    log.info({ data: { step: "process", dataId, operation } });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const result = { processed: true, dataId, operation };

    // Step 3: fan out a completion notification. Lazy-imported to break the
    // circular dependency between job modules and the trigger barrel.
    const { triggerNotification } = await import("../triggers");
    await triggerNotification({
      userId: "system",
      type: "in-app",
      title: "Processing Complete",
      message: `Data ${dataId} has been ${operation}ed successfully`,
    });

    return {
      ...result,
      timestamp: new Date().toISOString(),
    };
  },
});
