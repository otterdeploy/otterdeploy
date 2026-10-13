/**
 * Commands sent to nodes. A command is recorded before it is sent, with the
 * hash of its exact payload; its answer is recorded when it arrives. A lost
 * answer stays `unknown`: a retry reuses the op id (the node answers it from
 * its own record) and a changed payload under the same op id is a conflict.
 */
import { db } from "@otterdeploy/db";
import { otterdCommand } from "@otterdeploy/db/schema/otterd";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import { type StoreFailure, toStoreFailure } from "./errors";

export interface CommandRecord {
  opId: string;
  nodeId: string;
  verb: string;
  payloadHash: string;
  grantId: string | null;
  operationEpoch: number;
}

export function recordCommand(c: CommandRecord, now: number): Promise<Result<void, StoreFailure>> {
  return Result.tryPromise({
    catch: toStoreFailure,
    try: async () => {
      await db
        .insert(otterdCommand)
        .values({ ...c, state: "sent", sentAt: now })
        .onConflictDoUpdate({ target: otterdCommand.opId, set: { sentAt: now } });
    },
  });
}

export function answerCommand(
  opId: string,
  state: "completed" | "failed" | "unknown",
  outcome: Record<string, unknown>,
  now: number,
): Promise<Result<void, StoreFailure>> {
  return Result.tryPromise({
    catch: toStoreFailure,
    try: async () => {
      await db
        .update(otterdCommand)
        .set({ state, outcome, answeredAt: now })
        .where(eq(otterdCommand.opId, opId));
    },
  });
}
