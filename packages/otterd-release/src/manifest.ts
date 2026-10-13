import type * as z from "zod";

/**
 * Building, signing and checking an otterd release manifest
 * (`otterd/release-manifest/v1`): the document a node verifies against its
 * pinned release keys before it installs or upgrades. One manifest signs
 * every binary of the release (`otterd`, `otterd-guard`, `otterd-dns`,
 * `otterd-net`, `otterd-recover`) for each architecture.
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
  OTTERD,
  artifactName,
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

/** One binary of a release; `name` defaults to `otterd`. */
export interface ReleaseBinary {
  name?: string;
  arch: string;
  bytes: Uint8Array;
}

export interface ReleaseInput {
  version: string;
  binaries: readonly ReleaseBinary[];
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

const nameOf = (b: { name?: string }) => b.name ?? OTTERD;

/**
 * The manifest naming each binary by name, architecture, size and SHA-256.
 * The daemon's own binary is listed unnamed, as nodes look it up.
 */
export function buildManifest(input: ReleaseInput): Result<UnsignedRelease, string> {
  const unknown = input.binaries.find((b) => !ARCHES.has(b.arch));
  if (unknown !== undefined) return Result.err(`unknown architecture ${unknown.arch}`);
  const keys = input.binaries.map((b) => `${nameOf(b)}/${b.arch}`);
  if (new Set(keys).size !== keys.length) return Result.err("one binary per name and architecture");
  if (!input.binaries.some((b) => nameOf(b) === OTTERD)) {
    return Result.err("a release needs the otterd binary");
  }
  const parsed = releaseManifest.safeParse({
    version: input.version,
    artifacts: input.binaries.map((b) => ({
      ...(nameOf(b) === OTTERD ? {} : { name: nameOf(b) }),
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
  binaries: readonly ReleaseBinary[] = [],
): Result<ReleaseManifest, string> {
  const valid = keys.keys
    .filter((k) => (k.notBeforeUnixMs ?? 0) <= now && (k.notAfterUnixMs ?? Infinity) > now)
    .map((k) => k.key);
  const verified = verifyAndParse(envelope, valid, CONTEXT, releaseManifest);
  if (verified.isErr())
    return Result.err(`release does not verify: ${JSON.stringify(verified.error)}`);
  const manifest = verified.value;
  for (const b of binaries) {
    const name = nameOf(b);
    const want = manifest.artifacts.find((a) => artifactName(a) === name && a.arch === b.arch);
    if (!want) return Result.err(`the release does not sign ${name} for ${b.arch}`);
    if (want.size !== b.bytes.length || want.sha256 !== sha256HexOf(b.bytes)) {
      return Result.err(`${name} for ${b.arch} does not match the release`);
    }
  }
  return Result.ok(manifest);
}
