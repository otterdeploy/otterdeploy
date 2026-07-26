#!/usr/bin/env bun
/**
 * Standalone, zero-dependency control-plane recovery-key CLI — od-5j8.13.
 *
 * `scripts/control-plane-backup.sh` / `scripts/control-plane-restore.sh` run
 * this via `docker run --rm -v <workdir>:/data oven/bun:<pinned> bun
 * /data/recovery-key.mjs ...` (the script is bind-mounted alongside the data
 * it operates on) rather than the production otterdeploy image: that image
 * deliberately excludes `apps/cli` and its dependencies (see
 * `apps/server/Dockerfile` — `bun install --filter server --filter builder
 * --production`), and a fresh-VPS restore can't assume the otterdeploy image
 * has even been pulled yet. A bare `oven/bun` image + this one file needs
 * NOTHING else: no workspace resolution, no `bun install`, no network.
 *
 * This is a deliberate, tested port of
 * `packages/api/src/lib/recovery-key.ts` — NOT a reimplementation from
 * scratch. The two must produce byte-identical archives; that equivalence is
 * asserted by `packages/api/src/lib/__tests__/recovery-key-script-parity.test.ts`,
 * which shells out to this exact file. If you change the framing here, change
 * it there too and re-run that test.
 */

import { readFileSync, writeFileSync } from "node:fs";

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const FINGERPRINT_PREFIX_BYTES = 4;
const MAGIC = "OTCPBK1\0";

const textEncoder = new TextEncoder();

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

function normalizeKeyInput(input) {
  return input.replace(/[\s-]/g, "").toLowerCase();
}

function isValidKey(value) {
  return /^[0-9a-f]{64}$/i.test(value.trim());
}

function requireValidKey(hex) {
  if (!isValidKey(hex)) {
    throw new Error("recovery key must be 64 hex chars (32 bytes)");
  }
}

async function importAesKey(rawKeyBytes) {
  return crypto.subtle.importKey("raw", rawKeyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function generateKey() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}

async function fingerprint(keyHex) {
  const digest = await sha256(hexToBytes(keyHex));
  return bytesToHex(digest.slice(0, 8));
}

async function wrap(plaintext, keyHex) {
  requireValidKey(keyHex);
  const keyBytes = hexToBytes(keyHex);
  const fingerprintPrefix = (await sha256(keyBytes)).slice(0, FINGERPRINT_PREFIX_BYTES);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const key = await importAesKey(keyBytes);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext),
  );
  const magicBytes = textEncoder.encode(MAGIC);
  const out = new Uint8Array(magicBytes.length + fingerprintPrefix.length + nonce.length + ciphertext.length);
  let offset = 0;
  out.set(magicBytes, offset);
  offset += magicBytes.length;
  out.set(fingerprintPrefix, offset);
  offset += fingerprintPrefix.length;
  out.set(nonce, offset);
  offset += nonce.length;
  out.set(ciphertext, offset);
  return out;
}

async function unwrap(blob, keyHex) {
  requireValidKey(keyHex);
  const magicBytes = textEncoder.encode(MAGIC);
  const headerLen = magicBytes.length + FINGERPRINT_PREFIX_BYTES + NONCE_BYTES;
  if (blob.length < headerLen) throw new Error("archive is corrupt or truncated (shorter than the fixed header)");
  let offset = 0;
  const magic = blob.subarray(offset, offset + magicBytes.length);
  offset += magicBytes.length;
  if (!bytesEqual(magic, magicBytes)) throw new Error("archive is corrupt (bad magic)");
  const embeddedFingerprint = blob.subarray(offset, offset + FINGERPRINT_PREFIX_BYTES);
  offset += FINGERPRINT_PREFIX_BYTES;
  const nonce = blob.subarray(offset, offset + NONCE_BYTES);
  offset += NONCE_BYTES;
  const ciphertext = blob.subarray(offset);

  const keyBytes = hexToBytes(keyHex);
  const expectedFingerprint = (await sha256(keyBytes)).slice(0, FINGERPRINT_PREFIX_BYTES);
  if (!bytesEqual(embeddedFingerprint, expectedFingerprint)) {
    throw new Error("recovery key does not match this archive — check it against the printed fingerprint");
  }
  const key = await importAesKey(keyBytes);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext);
    return new Uint8Array(plaintext);
  } catch (cause) {
    throw new Error(`archive is corrupt or was tampered with: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const name = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[name] = next;
        i++;
      } else {
        out[name] = "true";
      }
    }
  }
  return out;
}

function resolveKey(args) {
  const raw = args.key ?? process.env.OTTERDEPLOY_RECOVERY_KEY;
  if (!raw) {
    process.stderr.write("error: pass --key or set OTTERDEPLOY_RECOVERY_KEY\n");
    process.exit(1);
  }
  const normalized = normalizeKeyInput(raw);
  if (!isValidKey(normalized)) {
    process.stderr.write("error: recovery key must be 64 hex chars (16 groups of 4)\n");
    process.exit(1);
  }
  return normalized;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (command === "generate") {
    const key = generateKey();
    process.stdout.write(`${key}\n`);
    return;
  }

  if (command === "fingerprint") {
    const key = resolveKey(args);
    process.stdout.write(`${await fingerprint(key)}\n`);
    return;
  }

  if (command === "encrypt") {
    if (!args.in || !args.out) {
      process.stderr.write("usage: recovery-key.mjs encrypt --in <file> --out <file> [--key <key>]\n");
      process.exit(1);
    }
    const key = resolveKey(args);
    const plaintext = new Uint8Array(readFileSync(args.in));
    const wrapped = await wrap(plaintext, key);
    writeFileSync(args.out, wrapped);
    process.stderr.write(`encrypted ${plaintext.length} bytes -> ${wrapped.length} bytes\n`);
    return;
  }

  if (command === "decrypt") {
    if (!args.in || !args.out) {
      process.stderr.write("usage: recovery-key.mjs decrypt --in <file> --out <file> [--key <key>]\n");
      process.exit(1);
    }
    const key = resolveKey(args);
    const blob = new Uint8Array(readFileSync(args.in));
    try {
      const plaintext = await unwrap(blob, key);
      writeFileSync(args.out, plaintext);
      process.stderr.write(`decrypted ${blob.length} bytes -> ${plaintext.length} bytes\n`);
    } catch (cause) {
      process.stderr.write(`error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
      process.exit(1);
    }
    return;
  }

  process.stderr.write("usage: recovery-key.mjs <generate|fingerprint|encrypt|decrypt> [...args]\n");
  process.exit(1);
}

await main();
