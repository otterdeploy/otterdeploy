/**
 * Encrypt-at-rest for env var VALUES (od-3pp7, Coolify parity).
 *
 * Before this module, `service_env_var.value` / `project_env_var.value`
 * were plaintext unless the row was `sealed` — a DB dump leaked every
 * tenant secret. Now EVERY write path encrypts through the existing v2
 * "env-vars" domain envelope (packages/api/src/lib/crypto.ts), and every
 * read path decrypts through `decryptEnvValue`, which passes pre-existing
 * plaintext rows through untouched until the one-shot backfill
 * (packages/api/scripts/encrypt-env-vars.ts) re-encrypts them.
 *
 * Sealed rows are OUT of this module's read path on purpose: their
 * write-only contract ("plaintext never leaves the resolver") is enforced
 * by callers checking the `sealed` flag, so `decryptUnsealedEnvRows`
 * returns sealed rows ciphertext-and-all and only the deploy-time resolver
 * decrypts them.
 */

import { Result } from "better-result";

import { decryptForDomain, encryptForDomain } from "./crypto";
import { isV2Format, parseV2Envelope } from "./crypto-envelope";

/** Encrypt one env value for storage. Same envelope sealed rows use. */
export function encryptEnvValue(plaintext: string): Promise<string> {
  return encryptForDomain(plaintext, "env-vars");
}

/**
 * Decrypt one stored env value, or pass it through when it predates
 * encrypt-at-rest (legacy plaintext row).
 *
 * The passthrough test is STRUCTURAL, not try-decrypt-and-swallow: only a
 * string that parses as a well-formed v2 envelope in the "env-vars" domain
 * is decrypted, so a user value that merely starts with "v2:" stays the
 * literal text it is — while a real envelope that fails to decrypt throws
 * loudly (that's a keyring problem, never something to paper over by
 * handing ciphertext to a deploy).
 */
export async function decryptEnvValue(stored: string): Promise<string> {
  if (!isV2Format(stored)) return stored;
  const parsed = Result.try(() => parseV2Envelope(stored));
  if (parsed.isErr() || parsed.value.domain !== "env-vars") return stored;
  return decryptForDomain(stored, "env-vars");
}

/**
 * Decrypt the `value` of every UNSEALED row; sealed rows come back
 * unchanged (write-only contract, see module doc). The canonical env list
 * queries funnel through this so their consumers keep seeing exactly the
 * plaintext they saw before encrypt-at-rest.
 */
export async function decryptUnsealedEnvRows<T extends { value: string; sealed: boolean }>(
  rows: T[],
): Promise<T[]> {
  return Promise.all(
    rows.map(async (row) =>
      row.sealed ? row : { ...row, value: await decryptEnvValue(row.value) },
    ),
  );
}
