/**
 * SSH keypair generation + public-key parsing, by shelling out to the host
 * `ssh-keygen` (same posture as the builder shelling out to `railpack`). Doing
 * it with the canonical tool means we emit exactly the OpenSSH formats every
 * Git host and SSH server already accept — no hand-rolled wire encoding to get
 * subtly wrong.
 *
 * These functions THROW on failure; callers wrap them in `Result.tryPromise`
 * so the Result-typed handler layer stays free of raw try/catch.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type SshKeyType = "ed25519" | "rsa" | "ecdsa";

export interface GeneratedKeyPair {
  type: SshKeyType;
  /** Bits — set for rsa/ecdsa, null for ed25519 (fixed-size). */
  bits: number | null;
  /** OpenSSH public-key line: "ssh-ed25519 AAAA… comment". */
  publicKey: string;
  /** OpenSSH private key (PEM "BEGIN OPENSSH PRIVATE KEY"). Encrypted if a
   *  passphrase was supplied. Caller encrypts this at rest. */
  privateKey: string;
  /** "SHA256:…". */
  fingerprint: string;
  comment: string | null;
}

export interface ParsedPublicKey {
  type: SshKeyType;
  bits: number | null;
  fingerprint: string;
  comment: string | null;
}

/** Default sizes when the caller doesn't pin `bits`. ed25519 is fixed-size. */
const DEFAULT_BITS: Record<SshKeyType, number | null> = {
  ed25519: null,
  rsa: 4096,
  ecdsa: 256,
};

class SshKeygenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SshKeygenError";
  }
}

export class InvalidPublicKeyError extends Error {
  constructor(message = "Not a valid OpenSSH public key.") {
    super(message);
    this.name = "InvalidPublicKeyError";
  }
}

async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["ssh-keygen", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

/**
 * Parse a `ssh-keygen -lf` line:
 *   "256 SHA256:/WYb…PFY demo@otterdeploy (ED25519)"
 *   bits ^   fingerprint ^        comment ^   type ^
 */
function parseFingerprintLine(line: string): ParsedPublicKey {
  const trimmed = line.trim();
  const bitsMatch = trimmed.match(/^(\d+)\s+/);
  const fpMatch = trimmed.match(/\bSHA256:[A-Za-z0-9+/=]+/);
  const typeMatch = trimmed.match(/\(([A-Z0-9-]+)\)\s*$/);
  if (!fpMatch || !typeMatch || typeMatch[1] === undefined) {
    throw new InvalidPublicKeyError();
  }
  const rawType = typeMatch[1].toLowerCase();
  const type: SshKeyType =
    rawType === "ed25519"
      ? "ed25519"
      : rawType === "rsa"
        ? "rsa"
        : rawType.startsWith("ecdsa")
          ? "ecdsa"
          : (() => {
              throw new InvalidPublicKeyError(`Unsupported key type "${rawType}".`);
            })();
  // The comment is everything between the fingerprint and the trailing "(TYPE)".
  const after = trimmed.slice((fpMatch.index ?? 0) + fpMatch[0].length, typeMatch.index);
  const comment = after.trim() || null;
  const bits = type === "ed25519" ? null : bitsMatch ? Number(bitsMatch[1]) : null;
  return { type, bits, fingerprint: fpMatch[0], comment };
}

export async function generateKeyPair(opts: {
  type: SshKeyType;
  bits?: number | null;
  comment?: string | null;
  passphrase?: string | null;
}): Promise<GeneratedKeyPair> {
  const dir = await mkdtemp(join(tmpdir(), "otter-sshkey-"));
  const keyPath = join(dir, "key");
  try {
    const bits = opts.bits ?? DEFAULT_BITS[opts.type];
    const args = [
      "-t",
      opts.type,
      "-f",
      keyPath,
      "-N",
      opts.passphrase ?? "",
      "-C",
      opts.comment ?? "",
      "-q",
    ];
    if (bits != null) {
      args.push("-b", String(bits));
    }
    const { code, stderr } = await run(args);
    if (code !== 0) {
      throw new SshKeygenError(stderr.trim() || `ssh-keygen exited with code ${code}`);
    }
    const [privateKey, publicKey] = await Promise.all([
      readFile(keyPath, "utf8"),
      readFile(`${keyPath}.pub`, "utf8"),
    ]);
    const { stdout: fpOut, code: fpCode } = await run(["-lf", `${keyPath}.pub`]);
    if (fpCode !== 0) {
      throw new SshKeygenError("failed to read fingerprint of generated key");
    }
    const parsed = parseFingerprintLine(fpOut);
    return {
      type: opts.type,
      bits: bits ?? null,
      publicKey: publicKey.trim(),
      privateKey,
      fingerprint: parsed.fingerprint,
      comment: opts.comment?.trim() || null,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Validate a pasted public-key line and extract its type / bits / fingerprint /
 * comment. Throws `InvalidPublicKeyError` if `ssh-keygen` won't parse it.
 */
export async function parsePublicKey(
  publicKey: string,
): Promise<ParsedPublicKey & { publicKey: string }> {
  const line = publicKey.trim();
  if (!line) throw new InvalidPublicKeyError("Empty public key.");
  const dir = await mkdtemp(join(tmpdir(), "otter-sshpub-"));
  const pubPath = join(dir, "key.pub");
  try {
    await writeFile(pubPath, `${line}\n`, "utf8");
    const { stdout, code } = await run(["-lf", pubPath]);
    if (code !== 0) {
      throw new InvalidPublicKeyError();
    }
    const parsed = parseFingerprintLine(stdout);
    // Prefer the comment as actually written on the key line (ssh-keygen -l
    // echoes it, but normalise from the source for fidelity).
    const lineComment = line.split(/\s+/).slice(2).join(" ").trim() || null;
    return { ...parsed, comment: lineComment ?? parsed.comment, publicKey: line };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
