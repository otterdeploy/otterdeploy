import { createHash } from "node:crypto";

export function encodeLegacySecret(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64");
}

export function decodeLegacySecret(value: string): string {
  try {
    return Buffer.from(value, "base64").toString("utf-8");
  } catch {
    return value;
  }
}

export function hashSecretDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
