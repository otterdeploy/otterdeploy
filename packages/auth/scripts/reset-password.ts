/**
 * Operator-facing password reset — writes a fresh credential hash straight
 * into the `account` table.
 *
 * This exists for the lockout case: no SMTP is configured (or nobody can read
 * the mailbox any more), so the dashboard's "forgot password" flow is a dead
 * end, and whoever has shell access to the box needs a way back in.
 *
 * Use THIS rather than hand-writing a value into Postgres. better-auth's
 * credential hash is scrypt in its own `salt:key` hex framing; a bcrypt digest
 * or a plaintext string dropped into `account.password` does not error on
 * write, it just makes every future sign-in fail with an indistinguishable
 * "invalid email or password".
 *
 * ── Usage (from packages/auth) ───────────────────────────────────────────
 *
 *   bun run reset:password --email you@example.com
 *   bun run reset:password --email you@example.com --password 'a long passphrase'
 *   bun run reset:password --email you@example.com --clear-2fa
 *
 * With no --password one is generated and printed once — prefer that over
 * putting a real secret in your shell history. Every existing session for the
 * user is revoked unless you pass --keep-sessions; --clear-2fa additionally
 * drops the TOTP enrolment, for when the authenticator is gone too.
 *
 * Runs against whatever DATABASE_URL the loaded env file points at. On a live
 * installation that is the production database — there is no dry-run.
 */

import { db } from "@otterdeploy/db";
import { account, session, twoFactor, user } from "@otterdeploy/db/schema";
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { hashPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import { parseArgs } from "node:util";

// better-auth's own default floor (`emailAndPassword.minPasswordLength`). The
// sign-in path re-checks it, so a shorter hash written here would be unusable.
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

// Ambiguity-free alphabet: a generated password gets read off a terminal and
// typed into a browser by hand.
const GENERATED_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GENERATED_LENGTH = 24;

function generatePassword(): string {
  const bytes = new Uint8Array(GENERATED_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) {
    out += GENERATED_ALPHABET.charAt(byte % GENERATED_ALPHABET.length);
  }
  return out;
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    password: { type: "string" },
    "clear-2fa": { type: "boolean", default: false },
    "keep-sessions": { type: "boolean", default: false },
  },
});

const email = values.email?.trim();
if (!email) {
  fail("--email is required. Usage: bun run reset:password --email you@example.com");
}

const generated = values.password === undefined;
const password = values.password ?? generatePassword();
if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
  fail(`password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`);
}

// Emails are stored as the user typed them at signup, so match
// case-insensitively rather than guessing at normalisation.
const matches = await db
  .select({
    id: user.id,
    name: user.name,
    email: user.email,
    twoFactorEnabled: user.twoFactorEnabled,
  })
  .from(user)
  .where(sql`lower(${user.email}) = lower(${email})`)
  .limit(2);

const target = matches[0];
if (!target) {
  fail(`no user with email ${email}`);
}
if (matches.length > 1) {
  fail(`${email} matches more than one user — resolve the duplicate before resetting`);
}

const hash = await hashPassword(password);
const now = new Date();

// Update first: a user who signed up with email+password already has the
// credential row, and reusing it keeps its id. The insert only covers the
// OAuth/SSO-only user who has never had a password at all.
const updated = await db
  .update(account)
  .set({ password: hash, updatedAt: now })
  .where(and(eq(account.userId, target.id), eq(account.providerId, "credential")))
  .returning({ id: account.id });

const created = updated.length === 0;
if (created) {
  await db.insert(account).values({
    id: createId(ID_PREFIX.account),
    accountId: target.id,
    providerId: "credential",
    userId: target.id,
    password: hash,
    updatedAt: now,
  });
}

let revoked = 0;
if (!values["keep-sessions"]) {
  const gone = await db
    .delete(session)
    .where(eq(session.userId, target.id))
    .returning({ id: session.id });
  revoked = gone.length;
}

if (values["clear-2fa"]) {
  await db.delete(twoFactor).where(eq(twoFactor.userId, target.id));
  await db
    .update(user)
    .set({ twoFactorEnabled: false, updatedAt: now })
    .where(eq(user.id, target.id));
}

console.log(`✓ password ${created ? "set" : "reset"} for ${target.email} (${target.name})`);
if (generated) {
  console.log(`  new password: ${password}`);
  console.log("  Copy it now — it is not stored anywhere and cannot be printed again.");
}
console.log(
  `  sessions revoked: ${values["keep-sessions"] ? "skipped (--keep-sessions)" : revoked}`,
);
if (values["clear-2fa"]) {
  console.log("  two-factor enrolment cleared — sign-in no longer asks for a TOTP code.");
} else if (target.twoFactorEnabled) {
  console.log("  NOTE: two-factor is still enabled; sign-in will ask for a code.");
  console.log("        Re-run with --clear-2fa if the authenticator is also lost.");
}

process.exit(0);
