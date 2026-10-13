import type * as z from "zod";

/**
 * Building, signing and checking an otterd release manifest
 * (`otterd/release-manifest/v1`): the document a node verifies against its
 * pinned release keys before it installs or upgrades to a binary.
 *
 * Signing goes through one interface so the key can live anywhere: a seed
 * the release job reads from its secret store, or an offline key that signs
 * the exact signing input on another machine and hands back the signature.
 * Either way the result is checked against the public key before it is
 * written, so a wrong key or a corrupted signature never leaves this tool.
 */
import {
  type ReleaseManifest,
  type SignedEnvelope,
  keyIdOf,
  publicKeyFromSeed,
  type releaseKeySet,
  releaseManifest,
  sha256HexOf,
  signingInput,
  verifyAndParse,
} from "@otterdeploy/otterd-proto";
import { Result } from "better-result";
import { createPrivateKey, sign } from "node:crypto";

type ReleaseKeySet = z.infer<typeof releaseKeySet>;

const CONTEXT = "otterd/release-manifest/v1";
const ARCHES = new Set(["x86_64", "aarch64"]);

export interface ReleaseInput {
  version: string;
  binaries: readonly { arch: string; bytes: Uint8Array }[];
  protocol: { min: number; max: number };
  journalFormat: number;
  minRollbackVersion: string;
  issuedAtUnixMs: number;
}

export interface UnsignedRelease {
  manifest: ReleaseManifest;
  /** The exact bytes that get signed and shipped. */
  payload: Uint8Array;
}

/** The manifest naming each binary by architecture, size and SHA-256. */
export function buildManifest(input: ReleaseInput): Result<UnsignedRelease, string> {
  const arches = input.binaries.map((b) => b.arch);
  const unknown = arches.find((a) => !ARCHES.has(a));
  if (unknown !== undefined) return Result.err(`unknown architecture ${unknown}`);
  if (new Set(arches).size !== arches.length) return Result.err("one binary per architecture");
  if (arches.length === 0) return Result.err("a release needs at least one binary");
  const parsed = releaseManifest.safeParse({
    version: input.version,
    artifacts: input.binaries.map((b) => ({
      arch: b.arch,
      sha256: sha256HexOf(b.bytes),
      size: b.bytes.length,
    })),
    protocol: input.protocol,
    journalFormat: input.journalFormat,
    minRollbackVersion: input.minRollbackVersion,
    issuedAtUnixMs: input.issuedAtUnixMs,
  });
  if (!parsed.success) return Result.err(parsed.error.message);
  const manifest = parsed.data;
  return Result.ok({ manifest, payload: new TextEncoder().encode(JSON.stringify(manifest)) });
}

/** Who signs: the public key, and a signature over the exact signing input. */
export interface ReleaseSigner {
  publicKey: string;
  sign(input: Uint8Array): Promise<Uint8Array>;
}

/** PKCS#8 wrapping of a raw 32-byte Ed25519 seed. */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** A signer holding the 32-byte seed itself (a release job reading its secret). */
export function seedSigner(seed: Uint8Array): ReleaseSigner {
  const key = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  return {
    publicKey: publicKeyFromSeed(seed),
    sign: async (input) => new Uint8Array(sign(null, input, key)),
  };
}

/** A signature made elsewhere over `signingInputOf(payload)`. */
export function detachedSigner(publicKey: string, signature: Uint8Array): ReleaseSigner {
  return { publicKey, sign: async () => signature };
}

/** The bytes an offline key signs: the context, a zero byte, then the payload. */
export const signingInputOf = (payload: Uint8Array): Uint8Array =>
  new Uint8Array(signingInput(CONTEXT, payload));

/** Sign the payload and check the envelope verifies under the signer's key. */
export async function signRelease(
  payload: Uint8Array,
  signer: ReleaseSigner,
): Promise<Result<SignedEnvelope, string>> {
  const signature = await signer.sign(signingInputOf(payload));
  const envelope: SignedEnvelope = {
    context: CONTEXT,
    keyId: keyIdOf(signer.publicKey),
    payload: Buffer.from(payload).toString("base64"),
    signature: Buffer.from(signature).toString("base64"),
  };
  const checked = verifyAndParse(envelope, [signer.publicKey], CONTEXT, releaseManifest);
  return checked.isOk()
    ? Result.ok(envelope)
    : Result.err(`signature does not verify: ${JSON.stringify(checked.error)}`);
}

/**
 * What a node checks: the manifest verifies under a key of the set valid at
 * `now`, and each binary given matches its architecture's size and SHA-256.
 */
export function verifyRelease(
  envelope: SignedEnvelope,
  keys: ReleaseKeySet,
  now: number,
  binaries: readonly { arch: string; bytes: Uint8Array }[] = [],
): Result<ReleaseManifest, string> {
  const valid = keys.keys
    .filter((k) => (k.notBeforeUnixMs ?? 0) <= now && (k.notAfterUnixMs ?? Infinity) > now)
    .map((k) => k.key);
  const verified = verifyAndParse(envelope, valid, CONTEXT, releaseManifest);
  if (verified.isErr())
    return Result.err(`release does not verify: ${JSON.stringify(verified.error)}`);
  const manifest = verified.value;
  for (const b of binaries) {
    const want = manifest.artifacts.find((a) => a.arch === b.arch);
    if (!want) return Result.err(`the release has no ${b.arch} binary`);
    if (want.size !== b.bytes.length || want.sha256 !== sha256HexOf(b.bytes)) {
      return Result.err(`the ${b.arch} binary does not match the release`);
    }
  }
  return Result.ok(manifest);
}
