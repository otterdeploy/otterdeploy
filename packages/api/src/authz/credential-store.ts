/**
 * Whether the credential store (Postgres, where better-auth keeps sessions and
 * API keys) can answer at all.
 *
 * Asked only after a lookup failed in a way that does not say whose fault it
 * was (see actor.ts): the api-key plugin answers a key it could not LOOK UP
 * with the same INVALID_API_KEY it gives a key that does not exist, and
 * better-auth answers a session it could not read with a 500. One trivial
 * statement settles it: a store that cannot run `select 1` judged nothing.
 */
import { db } from "@otterdeploy/db";
import { Result } from "better-result";
import { sql } from "drizzle-orm";

export async function credentialStoreAnswers(): Promise<Result<void, unknown>> {
  return Result.tryPromise({
    try: async () => {
      await db.execute(sql`select 1`);
    },
    catch: (cause) => cause,
  });
}
