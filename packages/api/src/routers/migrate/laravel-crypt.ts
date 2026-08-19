import { Result, TaggedError } from "better-result";
/**
 * Laravel `Crypt` decryption, for reading Coolify's encrypted columns
 * (od-b34a.2). Coolify stores env-var values (and some credentials) through
 * Laravel's `encrypted` model cast: base64(JSON{iv, value, mac[, tag]}),
 * AES-256-CBC, key = the base64 payload of APP_KEY ("base64:<key>"), and an
 * HMAC-SHA256 over (iv_b64 + value_b64) with the same key.
 *
 * Decrypt-only on purpose: we never write Coolify's format. The MAC is
 * verified before touching the ciphertext, so a truncated/corrupt column
 * fails loudly instead of yielding garbage plaintext into an import.
 *
 * Values written via `Crypt::encrypt` (serialize=true) come back
 * PHP-serialized (`s:<len>:"...";`); `encryptString`/the `encrypted` cast
 * do not. Both appear in Coolify's history, so the unwrap handles either.
 */
import { createDecipheriv, createHmac, timingSafeEqual } from "node:crypto";
import * as z from "zod";

class LaravelDecryptError extends TaggedError("LaravelDecryptError")<{
  message: string;
}>() {}

const payloadSchema = z.looseObject({
  iv: z.string().min(1),
  value: z.string().min(1),
  mac: z.string().min(1),
});

/** "base64:xxx" (the .env spelling) or already-raw base64. */
export function parseAppKey(appKey: string): Result<Buffer, LaravelDecryptError> {
  const b64 = appKey.startsWith("base64:") ? appKey.slice("base64:".length) : appKey;
  return Result.try({
    try: () => {
      const key = Buffer.from(b64, "base64");
      if (key.length !== 32) {
        throw new Error(`APP_KEY decodes to ${key.length} bytes; AES-256 needs 32`);
      }
      return key;
    },
    catch: (cause) =>
      new LaravelDecryptError({
        message: cause instanceof Error ? cause.message : "APP_KEY is not valid base64",
      }),
  });
}

/** Unwrap `s:<len>:"...";` (PHP serialize of a string); pass anything else. */
function unwrapPhpSerializedString(value: string): string {
  const m = /^s:\d+:"([\s\S]*)";$/.exec(value);
  return m?.[1] ?? value;
}

export function decryptLaravelValue(
  payload: string,
  key: Buffer,
): Result<string, LaravelDecryptError> {
  return Result.try({
    try: () => {
      const parsed = payloadSchema.parse(
        JSON.parse(Buffer.from(payload, "base64").toString("utf8")),
      );
      const expected = createHmac("sha256", key)
        .update(parsed.iv + parsed.value)
        .digest();
      const got = Buffer.from(parsed.mac, "hex");
      if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
        throw new Error("MAC verification failed (wrong APP_KEY or corrupt value)");
      }
      const decipher = createDecipheriv("aes-256-cbc", key, Buffer.from(parsed.iv, "base64"));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(parsed.value, "base64")),
        decipher.final(),
      ]).toString("utf8");
      return unwrapPhpSerializedString(plain);
    },
    catch: (cause) =>
      new LaravelDecryptError({
        message: cause instanceof Error ? cause.message : "not a Laravel-encrypted payload",
      }),
  });
}

/** Heuristic: a Laravel-encrypted column value is base64 of a JSON object.
 *  Cheap pre-check so plaintext columns (older Coolify rows) pass through. */
export function looksLaravelEncrypted(value: string): boolean {
  if (!/^[A-Za-z0-9+/=]+$/.test(value) || value.length < 40) return false;
  const head = Buffer.from(value.slice(0, 8), "base64").toString("utf8");
  return head.startsWith("{");
}
