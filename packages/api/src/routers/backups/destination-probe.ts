/**
 * Live write-read probe for a backup destination: initialize (or re-check) a
 * tiny reserved probe repository with the destination's actual credentials.
 * `init` writes real objects, `check` reads them back, so a green test means
 * "a backup written here can be read back", not merely "the form was filled
 * in". Split from destination-service.ts for the line budget.
 */
import type { JsonObject } from "@otterdeploy/shared/json";

import { Result } from "better-result";
import * as z from "zod";

import { deriveProbeRepoKey, toRusticRepo } from "../../backups/backends";
import { RusticCli } from "../../backups/rustic";
import { decryptSecret } from "../../lib/crypto";

const destinationSecretShape = z.record(z.string(), z.string());

type ProbeType = "s3" | "local" | "sftp" | "azblob" | "gcs";

/** Decrypt + parse the stored secret blob (empty for `local`). */
export async function decryptDestinationSecret(
  encryptedSecret: string,
): Promise<Result<Record<string, string>, Error>> {
  return Result.tryPromise({
    try: async () => destinationSecretShape.parse(JSON.parse(await decryptSecret(encryptedSecret))),
    catch: (cause) => (cause instanceof Error ? cause : new Error("decrypt")),
  });
}

/** Run the live probe. `err` carries the backend's failure text. */
export async function probeDestination(input: {
  organizationId: string;
  type: ProbeType;
  config: JsonObject;
  secret: Record<string, string>;
  managed: boolean;
}): Promise<Result<void, Error>> {
  return Result.tryPromise({
    try: async () => {
      const dest = { type: input.type, config: input.config, secret: input.secret };
      const key = deriveProbeRepoKey(input.organizationId, {
        config: input.config,
        managed: input.managed,
      });
      const cli = new RusticCli(toRusticRepo(dest, key));
      await cli.ensureInit();
      await cli.check();
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
}
