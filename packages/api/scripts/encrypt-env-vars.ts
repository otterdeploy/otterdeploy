/**
 * One-shot backfill for od-3pp7 (encrypt ALL env var values at rest).
 *
 * Before od-3pp7, `service_env_var.value` and `project_env_var.value` were
 * plaintext unless the row was sealed. New writes now always encrypt through
 * the v2 "env-vars" domain envelope, and every read decrypts-or-passes-
 * through, so the app works with a mixed table indefinitely — but a DB dump
 * only stops leaking once the old plaintext rows are re-encrypted. That is
 * this script's whole job.
 *
 * A row is backfilled when its value does not parse as a well-formed v2
 * "env-vars" envelope (the exact same structural test `decryptEnvValue`
 * uses for its passthrough decision, so backfill and read path can never
 * disagree about which rows are plaintext). Already-encrypted rows —
 * including every sealed row — are untouched.
 *
 * ── Usage ────────────────────────────────────────────────────────────────
 *
 *   # Preview what would change (writes nothing):
 *   bun --filter @otterdeploy/api encrypt:env-vars -- --dry-run
 *
 *   # Encrypt every remaining plaintext row:
 *   bun --filter @otterdeploy/api encrypt:env-vars
 *
 * Idempotent: a second run scans the same tables and reports 0 encrypted.
 * Safe to run while the app is live — the read path accepts both shapes.
 */
import { db } from "@otterdeploy/db";
import { projectEnvVar, serviceEnvVar } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import { isV2Format, parseV2Envelope } from "../src/lib/crypto-envelope";
import { encryptEnvValue } from "../src/lib/env-crypto";

const DRY_RUN = process.argv.includes("--dry-run");

/** Mirror of decryptEnvValue's passthrough test: only a well-formed v2
 *  envelope in the "env-vars" domain counts as already encrypted. */
function isEncrypted(value: string): boolean {
  if (!isV2Format(value)) return false;
  const parsed = Result.try(() => parseV2Envelope(value));
  return parsed.isOk() && parsed.value.domain === "env-vars";
}

interface BackfillSummary {
  table: string;
  scanned: number;
  encrypted: number;
  errors: number;
}

async function backfillColumn<TId>(input: {
  table: string;
  rows: Array<{ id: TId; value: string }>;
  writeBack: (id: TId, value: string) => Promise<void>;
}): Promise<BackfillSummary> {
  const summary: BackfillSummary = {
    table: input.table,
    scanned: input.rows.length,
    encrypted: 0,
    errors: 0,
  };
  for (const row of input.rows) {
    if (isEncrypted(row.value)) continue;
    const written = await Result.tryPromise(async () => {
      const ciphertext = await encryptEnvValue(row.value);
      if (!DRY_RUN) await input.writeBack(row.id, ciphertext);
    });
    if (written.isOk()) {
      summary.encrypted++;
    } else {
      summary.errors++;
      const cause = written.error;
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(
        `[encrypt-env-vars] ${input.table}#${String(row.id)}: failed to encrypt, ${message}`,
      );
    }
  }
  return summary;
}

async function backfillProjectEnvVars(): Promise<BackfillSummary> {
  const rows = await db
    .select({ id: projectEnvVar.id, value: projectEnvVar.value })
    .from(projectEnvVar);
  return backfillColumn({
    table: "project_env_var.value",
    rows,
    writeBack: (id, value) =>
      db.update(projectEnvVar).set({ value }).where(eq(projectEnvVar.id, id)).then(),
  });
}

async function backfillServiceEnvVars(): Promise<BackfillSummary> {
  const rows = await db
    .select({ id: serviceEnvVar.id, value: serviceEnvVar.value })
    .from(serviceEnvVar);
  return backfillColumn({
    table: "service_env_var.value",
    rows,
    writeBack: (id, value) =>
      db.update(serviceEnvVar).set({ value }).where(eq(serviceEnvVar.id, id)).then(),
  });
}

async function main(): Promise<void> {
  console.log(
    `[encrypt-env-vars] ${DRY_RUN ? "DRY RUN (no writes)" : "encrypting"} plaintext env var rows…`,
  );
  const summaries = [await backfillProjectEnvVars(), await backfillServiceEnvVars()];
  let failed = false;
  for (const s of summaries) {
    console.log(
      `[encrypt-env-vars] ${s.table}: scanned ${s.scanned}, ${DRY_RUN ? "would encrypt" : "encrypted"} ${s.encrypted}, errors ${s.errors}`,
    );
    if (s.errors > 0) failed = true;
  }
  if (failed) process.exit(1);
}

await main();
process.exit(0);
