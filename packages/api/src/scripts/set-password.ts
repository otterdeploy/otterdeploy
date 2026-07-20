/**
 * One-off admin utility: reset a user's email+password credential to a freshly
 * generated strong password, out-of-band from any login session.
 *
 * SELF-CONTAINED BY DESIGN. There's no better-auth `admin` plugin wired (see
 * packages/auth), so no admin.setUserPassword endpoint — and the deployed
 * server image bundles better-auth into dist, so the package isn't resolvable
 * at runtime there. So this imports NOTHING from the workspace or node_modules:
 * it reproduces better-auth's DEFAULT password hashing (scrypt, the algorithm
 * used because `emailAndPassword` declares no custom hasher) with node:crypto,
 * and writes via Bun's native SQL. It therefore runs anywhere `bun` + a
 * DATABASE_URL exist — including inside the pruned production container.
 *
 * Run it against the target's DATABASE_URL, e.g. inside the server container:
 *
 *   bun /app/packages/api/src/scripts/set-password.ts jacechuka+dev@gmail.com
 *
 * It prints the new password to stdout ONCE, and revokes existing sessions so a
 * stale cookie can't outlive the reset. Log in with the printed password, then
 * change it from the account page.
 */
import { SQL } from "bun";
import { randomBytes, scryptSync } from "node:crypto";

// better-auth's default scrypt parameters (better-auth/src/crypto/password.ts).
// If any of these drift from the installed better-auth version, a reset would
// produce a hash that silently fails to verify — keep in lockstep on upgrades.
const SCRYPT = { N: 16384, r: 16, p: 1, dkLen: 64 } as const;
const MAXMEM = 128 * SCRYPT.N * SCRYPT.r * 2;

/** Mirror better-auth's hashPassword: 16-byte hex salt, NFKC-normalized
 *  password, scrypt over the salt STRING, stored as `${saltHex}:${keyHex}`. */
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const key = scryptSync(password.normalize("NFKC"), salt, SCRYPT.dkLen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: MAXMEM,
  });
  return `${salt}:${key.toString("hex")}`;
}

/** ~24 url-safe chars (~144 bits) — strong, and safe to paste without escaping. */
function generatePassword(): string {
  return randomBytes(18).toString("base64url");
}

/** SQL to run manually (psql) when connecting from here isn't possible. The
 *  hash is hex+colon and the subselect keys off the email, so no id lookup is
 *  needed. */
function printSqlOnly(email: string, hash: string, password: string): void {
  console.log(`[set-password] new password for ${email}: ${password}\n`);
  console.log("-- run against the target database (psql):");
  console.log(
    `UPDATE account SET password = '${hash}', updated_at = now()\n` +
      `  WHERE user_id = (SELECT id FROM "user" WHERE email = '${email}') AND provider_id = 'credential';`,
  );
  console.log(
    `DELETE FROM session WHERE user_id = (SELECT id FROM "user" WHERE email = '${email}');`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sqlOnly = args.includes("--sql-only");
  const email = args.find((a) => !a.startsWith("--"))?.trim();
  if (!email) {
    console.error("usage: bun packages/api/src/scripts/set-password.ts <email> [--sql-only]");
    process.exit(1);
  }

  const password = generatePassword();
  const hash = hashPassword(password);

  const url = process.env.DATABASE_URL;
  // No DB reachable from here (or --sql-only): emit the SQL to run manually.
  if (sqlOnly || !url) {
    if (!url && !sqlOnly) {
      console.error(
        "[set-password] DATABASE_URL not set — printing SQL to run manually instead:\n",
      );
    }
    printSqlOnly(email, hash, password);
    process.exit(0);
  }

  const sql = new SQL(url);
  try {
    const users = await sql`SELECT id FROM "user" WHERE email = ${email}`;
    const target = users[0] as { id: string } | undefined;
    if (!target) {
      console.error(`[set-password] no user with email ${email}`);
      process.exit(1);
    }

    const updated = await sql`
      UPDATE account
      SET password = ${hash}, updated_at = now()
      WHERE user_id = ${target.id} AND provider_id = 'credential'
      RETURNING id`;
    if (updated.length === 0) {
      console.error(
        `[set-password] ${email} has no email+password credential — they likely sign in via OAuth/passkey only, so there's nothing to reset.`,
      );
      process.exit(1);
    }

    // Revoke existing sessions so an already-signed-in cookie can't outlive the
    // reset (nothing auto-invalidates sessions on an out-of-band change).
    const revoked = await sql`DELETE FROM session WHERE user_id = ${target.id} RETURNING id`;

    console.log(
      `[set-password] password reset for ${email} (${revoked.length} session(s) revoked)`,
    );
    console.log(`[set-password] new password: ${password}`);
  } finally {
    await sql.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("[set-password] failed:", err);
    process.exit(1);
  });
