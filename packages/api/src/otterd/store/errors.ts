import { db } from "@otterdeploy/db";
/**
 * Store errors. A refusal is a rule saying no (an occupied exclusive slot, a
 * release without evidence); a store error is the database failing. Both
 * leave every row as it was: refusals are raised inside the transaction.
 */
import { TaggedError } from "better-result";
import { Result } from "better-result";

import { type Tx, toDbError } from "../../health-data/sql";

class OtterdStoreError extends TaggedError("OtterdStoreError")<{
  message: string;
  /** SQLSTATE when the server raised it, else the driver's code. */
  code: string | null;
}>() {}

class OtterdRefusal extends TaggedError("OtterdRefusal")<{
  message: string;
  reason: string;
}>() {}

export type StoreFailure = OtterdStoreError | OtterdRefusal;

export function toStoreFailure(cause: unknown): StoreFailure {
  if (OtterdRefusal.is(cause) || OtterdStoreError.is(cause)) return cause;
  const e = toDbError(cause);
  return new OtterdStoreError({ message: e.message, code: e.code });
}

export const refusal = (reason: string, message: string): OtterdRefusal =>
  new OtterdRefusal({ reason, message });

/** `<prefix>_<128 random bits>`, never reused. */
export function mintId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `${prefix}_${Buffer.from(bytes).toString("hex")}`;
}

/** Run `f` in one transaction; a refusal or a database error rolls it back. */
export const run = <T>(f: (tx: Tx) => Promise<T>): Promise<Result<T, StoreFailure>> =>
  Result.tryPromise({ try: () => db.transaction(f), catch: toStoreFailure });
