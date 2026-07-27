/**
 * Operator-facing key rotation for packages/api/src/lib/crypto.ts's
 * domain-separated ciphertext (od-5j8.12).
 *
 * ── What this does ───────────────────────────────────────────────────────
 *
 * Walks every column that stores crypto.ts ciphertext and, for each row,
 * calls `rotateForDomain(value, domain)`:
 *
 *   - v1 legacy ciphertext              -> re-encrypted as a v2 envelope
 *   - v2 ciphertext on an OLD key id    -> re-encrypted under the current id
 *   - v2 ciphertext already current     -> left untouched (no-op, no write)
 *
 * Nothing is ever decrypted-and-discarded: a row is only written back if
 * `rotateForDomain` reports `rotated: true`, and the write is the freshly
 * re-encrypted value for the SAME logical secret — never a delete, never a
 * blind overwrite.
 *
 * ── Tables covered ───────────────────────────────────────────────────────
 *
 *   ssh_key.private_key_ciphertext              -> domain "ssh-keys"
 *   container_registry.encrypted_password        -> domain "registry-creds"
 *   custom_certificate.key_ciphertext             -> domain "certs"
 *   git_provider.client_secret_ciphertext         -> domain "git-secrets"
 *   git_provider.webhook_secret_ciphertext        -> domain "git-secrets"
 *   git_provider.private_key_pem_ciphertext       -> domain "git-secrets"
 *   project_env_var.value  (sealed = true only)   -> domain "env-vars"
 *   service_env_var.value  (sealed = true only)   -> domain "env-vars"
 *
 * NOT covered (documented gaps — see od-5j8.12's closing report):
 *   - backup archive encryption (encryptBytes/decryptBytes) stays on the
 *     shared legacy key in this pass; rotating BETTER_AUTH_SECRET itself
 *     (id "1") still re-keys it, same as before this feature existed.
 *   - database_resource.password is stored in PLAINTEXT today (pre-dates
 *     this rework entirely) — nothing to rotate, out of scope here.
 *   - the provision-runner "server-secrets" domain is BullMQ-job-payload
 *     lifetime only (consumed within one job run); nothing durable to walk.
 *
 * ── Usage ────────────────────────────────────────────────────────────────
 *
 *   # 1. Add a new key id to the keyring (keep the old id(s) too!):
 *   DATA_ENCRYPTION_KEYS="1:<original-secret>,2:<new-32+-char-secret>"
 *
 *   # 2. Point new writes at the new id:
 *   DATA_ENCRYPTION_KEY_ID=2
 *
 *   # 3. Preview what would change (writes nothing):
 *   bun --filter @otterdeploy/api rotate:encryption-keys -- --dry-run
 *
 *   # 4. Re-encrypt everything still on an old id/format:
 *   bun --filter @otterdeploy/api rotate:encryption-keys
 *
 *   # 5. Once you're confident nothing depends on the old id anymore, you
 *      MAY drop it from DATA_ENCRYPTION_KEYS — but only after confirming
 *      step 4 reports zero remaining rows on it (run it again; a clean run
 *      after a rotation reports 0 rotated across every table).
 *
 * Safe to run repeatedly (idempotent — a second run against already-current
 * ciphertext is a no-op) and safe to run with no rotation pending at all
 * (every table just reports 0 rotated).
 */
import { db } from "@otterdeploy/db";
import { containerRegistry } from "@otterdeploy/db/schema";
import { customCertificate } from "@otterdeploy/db/schema/certificates";
import { gitProvider } from "@otterdeploy/db/schema/git";
import { projectEnvVar, serviceEnvVar } from "@otterdeploy/db/schema/project";
import { sshKey } from "@otterdeploy/db/schema/ssh-key";
import { eq } from "drizzle-orm";

import { currentKeyId, rotateForDomain, type SecretDomain } from "../src/lib/crypto";

const DRY_RUN = process.argv.includes("--dry-run");

interface RotateSummary {
  table: string;
  domain: SecretDomain;
  scanned: number;
  rotated: number;
  errors: number;
}

async function rotateColumn<TId>(input: {
  table: string;
  domain: SecretDomain;
  rows: Array<{ id: TId; value: string | null }>;
  writeBack: (id: TId, value: string) => Promise<void>;
}): Promise<RotateSummary> {
  const summary: RotateSummary = {
    table: input.table,
    domain: input.domain,
    scanned: 0,
    rotated: 0,
    errors: 0,
  };
  for (const row of input.rows) {
    if (!row.value) continue;
    summary.scanned++;
    try {
      const { value, rotated } = await rotateForDomain(row.value, input.domain);
      if (!rotated) continue;
      summary.rotated++;
      if (!DRY_RUN) await input.writeBack(row.id, value);
    } catch (cause) {
      summary.errors++;
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(
        `[rotate-encryption-keys] ${input.table}#${String(row.id)}: failed to rotate (${input.domain}) — ${message}`,
      );
    }
  }
  return summary;
}

async function main(): Promise<void> {
  console.log(
    `[rotate-encryption-keys] current key id: "${currentKeyId()}"${DRY_RUN ? " (dry run — no writes)" : ""}`,
  );

  const summaries: RotateSummary[] = [];

  // ssh_key.private_key_ciphertext
  {
    const rows = await db
      .select({ id: sshKey.id, value: sshKey.privateKeyCiphertext })
      .from(sshKey);
    summaries.push(
      await rotateColumn({
        table: "ssh_key.private_key_ciphertext",
        domain: "ssh-keys",
        rows,
        writeBack: (id, value) =>
          db.update(sshKey).set({ privateKeyCiphertext: value }).where(eq(sshKey.id, id)).then(),
      }),
    );
  }

  // container_registry.encrypted_password
  {
    const rows = await db
      .select({ id: containerRegistry.id, value: containerRegistry.encryptedPassword })
      .from(containerRegistry);
    summaries.push(
      await rotateColumn({
        table: "container_registry.encrypted_password",
        domain: "registry-creds",
        rows,
        writeBack: (id, value) =>
          db
            .update(containerRegistry)
            .set({ encryptedPassword: value })
            .where(eq(containerRegistry.id, id))
            .then(),
      }),
    );
  }

  // custom_certificate.key_ciphertext
  {
    const rows = await db
      .select({ id: customCertificate.id, value: customCertificate.keyCiphertext })
      .from(customCertificate);
    summaries.push(
      await rotateColumn({
        table: "custom_certificate.key_ciphertext",
        domain: "certs",
        rows,
        writeBack: (id, value) =>
          db
            .update(customCertificate)
            .set({ keyCiphertext: value })
            .where(eq(customCertificate.id, id))
            .then(),
      }),
    );
  }

  // git_provider.{client_secret,webhook_secret,private_key_pem}_ciphertext
  {
    const rows = await db
      .select({
        id: gitProvider.id,
        clientSecretCiphertext: gitProvider.clientSecretCiphertext,
        webhookSecretCiphertext: gitProvider.webhookSecretCiphertext,
        privateKeyPemCiphertext: gitProvider.privateKeyPemCiphertext,
      })
      .from(gitProvider);

    summaries.push(
      await rotateColumn({
        table: "git_provider.client_secret_ciphertext",
        domain: "git-secrets",
        rows: rows.map((r) => ({ id: r.id, value: r.clientSecretCiphertext })),
        writeBack: (id, value) =>
          db
            .update(gitProvider)
            .set({ clientSecretCiphertext: value })
            .where(eq(gitProvider.id, id))
            .then(),
      }),
    );
    summaries.push(
      await rotateColumn({
        table: "git_provider.webhook_secret_ciphertext",
        domain: "git-secrets",
        rows: rows.map((r) => ({ id: r.id, value: r.webhookSecretCiphertext })),
        writeBack: (id, value) =>
          db
            .update(gitProvider)
            .set({ webhookSecretCiphertext: value })
            .where(eq(gitProvider.id, id))
            .then(),
      }),
    );
    summaries.push(
      await rotateColumn({
        table: "git_provider.private_key_pem_ciphertext",
        domain: "git-secrets",
        rows: rows.map((r) => ({ id: r.id, value: r.privateKeyPemCiphertext })),
        writeBack: (id, value) =>
          db
            .update(gitProvider)
            .set({ privateKeyPemCiphertext: value })
            .where(eq(gitProvider.id, id))
            .then(),
      }),
    );
  }

  // project_env_var.value — sealed rows only (non-sealed rows are plaintext
  // by design, nothing to rotate).
  {
    const rows = await db
      .select({ id: projectEnvVar.id, value: projectEnvVar.value })
      .from(projectEnvVar)
      .where(eq(projectEnvVar.sealed, true));
    summaries.push(
      await rotateColumn({
        table: "project_env_var.value (sealed)",
        domain: "env-vars",
        rows,
        writeBack: (id, value) =>
          db.update(projectEnvVar).set({ value }).where(eq(projectEnvVar.id, id)).then(),
      }),
    );
  }

  // service_env_var.value — sealed rows only.
  {
    const rows = await db
      .select({ id: serviceEnvVar.id, value: serviceEnvVar.value })
      .from(serviceEnvVar)
      .where(eq(serviceEnvVar.sealed, true));
    summaries.push(
      await rotateColumn({
        table: "service_env_var.value (sealed)",
        domain: "env-vars",
        rows,
        writeBack: (id, value) =>
          db.update(serviceEnvVar).set({ value }).where(eq(serviceEnvVar.id, id)).then(),
      }),
    );
  }

  console.log("");
  console.log(
    "table".padEnd(42),
    "scanned".padStart(8),
    "rotated".padStart(8),
    "errors".padStart(7),
  );
  let totalRotated = 0;
  let totalErrors = 0;
  for (const s of summaries) {
    console.log(
      s.table.padEnd(42),
      String(s.scanned).padStart(8),
      String(s.rotated).padStart(8),
      String(s.errors).padStart(7),
    );
    totalRotated += s.rotated;
    totalErrors += s.errors;
  }
  console.log("");
  console.log(
    `[rotate-encryption-keys] ${DRY_RUN ? "would rotate" : "rotated"} ${totalRotated} row(s), ${totalErrors} error(s).`,
  );
  if (DRY_RUN && totalRotated > 0) {
    console.log("[rotate-encryption-keys] re-run WITHOUT --dry-run to apply.");
  }
  if (totalErrors > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err: unknown) => {
    console.error("[rotate-encryption-keys] failed:", err);
    process.exit(1);
  });
