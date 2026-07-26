/**
 * Offline control-plane recovery-key operations — od-5j8.13.
 *
 * Deliberately network- and auth-free: every subcommand here works with no
 * login, no config file, and no reachable control-plane API, because its job
 * is to run in exactly the situation those things are unavailable — a fresh
 * VPS mid disaster-recovery restore, or an operator generating a key to save
 * offline before anything is even backed up yet.
 *
 * `scripts/control-plane-backup.sh` / `scripts/control-plane-restore.sh`
 * shell out to this command (via `docker run <otterdeploy image> bun
 * apps/cli/src/index.ts recovery-key ...`) rather than reimplementing the
 * AES-GCM framing in bash/openssl — see
 * `packages/api/src/lib/recovery-key.ts` for why that module has zero
 * dependency on env vars or a DB connection, which is what makes it safe to
 * bundle into this CLI and run standalone.
 */
import {
  formatRecoveryKeyForDisplay,
  generateRecoveryKey,
  isValidRecoveryKey,
  normalizeRecoveryKeyInput,
  recoveryKeyFingerprint,
  unwrapControlPlaneArchive,
  wrapControlPlaneArchive,
} from "@otterdeploy/api/lib/recovery-key";
import { defineCommand } from "citty";
import { readFileSync, writeFileSync } from "node:fs";

import { abort, detail, dim, hint, ok, out, secret, warn } from "../lib/ui";

/** Resolve the key from `--key`, `$OTTERDEPLOY_RECOVERY_KEY`, or an
 *  interactive hidden prompt, in that order — never accepted as a bare CLI
 *  arg only implicitly (it IS accepted via `--key`, but that's the
 *  operator's explicit choice; shells commonly leak argv into process
 *  listings and shell history, so the env var / prompt paths are the ones
 *  documented as the safe default in the DR runbook). */
async function resolveKey(args: { key?: string }): Promise<string> {
  // oxlint-disable-next-line node/no-process-env -- documented DR-script input; see the module doc comment
  const raw = args.key ?? process.env.OTTERDEPLOY_RECOVERY_KEY ?? (await secret("Recovery key:"));
  if (!raw) abort("A recovery key is required.", "pass --key, set OTTERDEPLOY_RECOVERY_KEY, or enter it when prompted");
  const normalized = normalizeRecoveryKeyInput(raw);
  if (!isValidRecoveryKey(normalized)) {
    abort("That doesn't look like a valid recovery key (expected 64 hex chars / 16 groups of 4).");
  }
  return normalized;
}

const generateCmd = defineCommand({
  meta: { name: "generate", description: "Generate a new recovery key (shown once — save it off-host)" },
  args: {
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const key = generateRecoveryKey();
    const displayKey = formatRecoveryKeyForDisplay(key);
    const fingerprint = await recoveryKeyFingerprint(key);
    if (args.json) {
      out(JSON.stringify({ key, displayKey, fingerprint }, null, 2));
      return;
    }
    warn("This key is shown ONCE. Save it somewhere off this host right now (password manager, printed and locked away).");
    out("");
    out(displayKey);
    out("");
    detail([["fingerprint", dim(fingerprint)]]);
    hint("register it with the control plane: otterdeploy backups control-plane confirm-key-exported");
  },
});

const fingerprintCmd = defineCommand({
  meta: { name: "fingerprint", description: "Print a key's fingerprint without exposing the key" },
  args: {
    key: { type: "string", description: "The recovery key (or use $OTTERDEPLOY_RECOVERY_KEY / prompt)" },
  },
  async run({ args }) {
    const key = await resolveKey(args);
    out(await recoveryKeyFingerprint(key));
  },
});

const encryptCmd = defineCommand({
  meta: { name: "encrypt", description: "Encrypt a control-plane archive with a recovery key" },
  args: {
    in: { type: "string", description: "Input file (the plaintext tar)", required: true },
    out: { type: "string", description: "Output file (the encrypted archive)", required: true },
    key: { type: "string", description: "The recovery key (or use $OTTERDEPLOY_RECOVERY_KEY / prompt)" },
  },
  async run({ args }) {
    const key = await resolveKey(args);
    const plaintext = readFileSync(args.in);
    const wrapped = await wrapControlPlaneArchive(plaintext, key);
    writeFileSync(args.out, wrapped);
    ok(`Encrypted ${plaintext.length} bytes -> ${wrapped.length} bytes.`);
    detail([
      ["in", dim(args.in)],
      ["out", dim(args.out)],
      ["fingerprint", dim(await recoveryKeyFingerprint(key))],
    ]);
  },
});

const decryptCmd = defineCommand({
  meta: { name: "decrypt", description: "Decrypt a control-plane archive with a recovery key" },
  args: {
    in: { type: "string", description: "Input file (the encrypted archive)", required: true },
    out: { type: "string", description: "Output file (the recovered plaintext tar)", required: true },
    key: { type: "string", description: "The recovery key (or use $OTTERDEPLOY_RECOVERY_KEY / prompt)" },
  },
  async run({ args }) {
    const key = await resolveKey(args);
    const blob = readFileSync(args.in);
    try {
      const plaintext = await unwrapControlPlaneArchive(blob, key);
      writeFileSync(args.out, plaintext);
      ok(`Decrypted ${blob.length} bytes -> ${plaintext.length} bytes.`);
      detail([
        ["in", dim(args.in)],
        ["out", dim(args.out)],
      ]);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      abort(`Could not decrypt the archive: ${message}`, "double-check the recovery key against its printed fingerprint");
    }
  },
});

export const recoveryKeyCommand = defineCommand({
  meta: { name: "recovery-key", description: "Generate and use control-plane backup recovery keys (offline)" },
  subCommands: {
    generate: generateCmd,
    fingerprint: fingerprintCmd,
    encrypt: encryptCmd,
    decrypt: decryptCmd,
  },
});
