import { createHash } from "node:crypto";
import { Result } from "better-result";

export function encodeLegacySecret(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64");
}

export function decodeLegacySecret(value: string): string {
  return Result.try({
    try: () => Buffer.from(value, "base64").toString("utf-8"),
    catch: () => value,
  }).unwrapOr(value);
}

export function hashSecretDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
