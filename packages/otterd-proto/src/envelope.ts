import { Result } from "better-result";
/**
 * Signed envelopes: Ed25519 over `context || 0x00 || payload` where payload is
 * the exact serialized bytes. Mirror of `envelope.rs`; signatures are
 * deterministic, so the same key and payload give byte-identical envelopes on
 * both sides (checked against `fixtures/vectors.json`).
 */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import * as z from "zod";

import { keyId, publicKey } from "./primitives";

export const SIGN_CONTEXTS = [
  "otterd/session/v1",
  "otterd/capability/v1",
  "otterd/lease/v1",
  "otterd/enroll-request/v1",
  "otterd/enroll/v1",
  "otterd/key-rotation/v1",
  "otterd/cp-key-transition/v1",
  "otterd/stop-certificate/v1",
  "otterd/authority-revoke/v1",
  "otterd/platform-boot-manifest/v1",
  "otterd/release-manifest/v1",
  "otterd/owner-snapshot/v1",
  "otterd/challenge-answer/v1",
  "otterd/serving-set/v1",
  "otterd/membership/v1",
  "otterd/peer-answer/v1",
  "otterd/anchor/v1",
  "otterd/key-rotation-ack/v1",
  "otterd/release-keys/v1",
] as const;

export const signContext = z.enum(SIGN_CONTEXTS);
export type SignContext = z.infer<typeof signContext>;

export const signedEnvelope = z.strictObject({
  context: signContext,
  keyId,
  payload: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/),
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
});
export type SignedEnvelope = z.infer<typeof signedEnvelope>;

export type EnvelopeError =
  | { kind: "context"; want: SignContext; got: SignContext }
  | { kind: "untrusted-key"; got: string }
  | { kind: "encoding"; detail: string }
  | { kind: "bad-signature" }
  | { kind: "payload"; detail: string };

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Short id of a public key: hex of the first 16 bytes of SHA-256(key). */
export function keyIdOf(publicKeyBase64: string): string {
  return createHash("sha256")
    .update(Buffer.from(publicKeyBase64, "base64"))
    .digest()
    .subarray(0, 16)
    .toString("hex");
}

export function signingInput(context: SignContext, payload: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from(context, "utf8"), Buffer.from([0]), payload]);
}

export function sha256HexOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function privateKeyFromSeed(seed: Uint8Array) {
  return createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
}

/** The base64 public key for a 32-byte Ed25519 seed. */
export function publicKeyFromSeed(seed: Uint8Array): string {
  const spki = createPublicKey(privateKeyFromSeed(seed)).export({ format: "der", type: "spki" });
  return spki.subarray(SPKI_ED25519_PREFIX.length).toString("base64");
}

/** Sign exact payload bytes. The caller serializes once and signs those bytes. */
export function signEnvelope(
  seed: Uint8Array,
  context: SignContext,
  payload: Uint8Array,
): SignedEnvelope {
  const signature = sign(null, signingInput(context, payload), privateKeyFromSeed(seed));
  return {
    context,
    keyId: keyIdOf(publicKeyFromSeed(seed)),
    payload: Buffer.from(payload).toString("base64"),
    signature: signature.toString("base64"),
  };
}

/**
 * Verify against one of the `trusted` keys (both keys during a rotation) and
 * return the exact payload bytes. Nothing in a rejected envelope is trusted.
 */
export function verifyEnvelope(
  envelope: SignedEnvelope,
  trusted: readonly string[],
  context: SignContext,
): Result<Uint8Array, EnvelopeError> {
  if (envelope.context !== context) {
    return Result.err({ kind: "context", want: context, got: envelope.context });
  }
  const key = trusted.find((k) => publicKey.safeParse(k).success && keyIdOf(k) === envelope.keyId);
  if (key === undefined) return Result.err({ kind: "untrusted-key", got: envelope.keyId });
  const payload = Buffer.from(envelope.payload, "base64");
  const signature = Buffer.from(envelope.signature, "base64");
  if (signature.length !== 64) return Result.err({ kind: "encoding", detail: "signature length" });
  const checked = Result.try({
    try: () =>
      verify(
        null,
        signingInput(context, payload),
        createPublicKey({
          key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(key, "base64")]),
          format: "der",
          type: "spki",
        }),
        signature,
      ),
    catch: (cause) => ({ kind: "encoding" as const, detail: String(cause) }),
  });
  if (checked.isErr()) return Result.err(checked.error);
  if (!checked.value) return Result.err({ kind: "bad-signature" });
  return Result.ok(new Uint8Array(payload));
}

/** Verify, then parse the verified bytes with `schema`. */
export function verifyAndParse<T>(
  envelope: SignedEnvelope,
  trusted: readonly string[],
  context: SignContext,
  schema: z.ZodType<T>,
): Result<T, EnvelopeError> {
  const bytes = verifyEnvelope(envelope, trusted, context);
  if (bytes.isErr()) return Result.err(bytes.error);
  const json = Result.try({
    try: (): unknown => JSON.parse(Buffer.from(bytes.value).toString("utf8")),
    catch: (cause) => ({ kind: "payload" as const, detail: String(cause) }),
  });
  if (json.isErr()) return Result.err(json.error);
  const parsed = schema.safeParse(json.value);
  if (!parsed.success) return Result.err({ kind: "payload", detail: parsed.error.message });
  return Result.ok(parsed.data);
}
