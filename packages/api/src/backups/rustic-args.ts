/**
 * Pure building blocks for the rustic CLI wrapper: password derivation, the
 * `forget` argv builder, TOML quoting, and the wrong-password matcher that
 * drives the keyring-candidate fallback. Split from rustic.ts (the
 * spawn/profile plumbing) so each stays unit-testable and under the line cap.
 */
import { hkdfSync } from "node:crypto";

/** GFS keep policy for `forget`. Maps 1:1 onto rustic's `--keep-*` flags. */
export interface ForgetSpec {
  keepLast?: number;
  keepHourly?: number;
  keepDaily?: number;
  keepWeekly?: number;
  keepMonthly?: number;
  keepYearly?: number;
  /** Hard max age in days → `--keep-within <N>d`. */
  keepWithinDays?: number | null;
}

/**
 * Derive a repo's encryption password: HKDF-SHA256 over a master secret with
 * `info = domain` (the repo key's `passwordDomain` — equals the repo id for
 * external destinations, org-qualified for managed ones; see
 * backends.deriveRepoKey), hex-encoded. Deterministic (re-derivable, no secret
 * store) and domain-separated per repo. Pure so it's unit-testable without env.
 */
export function deriveRepoPassword(secret: string, domain: string): string {
  const derived = hkdfSync(
    "sha256",
    Buffer.from(secret, "utf8"),
    Buffer.alloc(0),
    Buffer.from(domain, "utf8"),
    32,
  );
  return Buffer.from(derived).toString("hex");
}

/** Build the `forget` argv (pure, so the flag mapping is unit-testable). Only
 *  set tiers emit a flag; always scoped by `--filter-tags` and always `--prune`
 *  + `--json`. */
export function buildForgetArgs(spec: ForgetSpec, filterTags: string[]): string[] {
  const args = ["forget", "--filter-tags", filterTags.join(",")];
  const tier = (flag: string, n: number | undefined) => {
    if (n != null && n > 0) args.push(flag, String(n));
  };
  tier("--keep-last", spec.keepLast);
  tier("--keep-hourly", spec.keepHourly);
  tier("--keep-daily", spec.keepDaily);
  tier("--keep-weekly", spec.keepWeekly);
  tier("--keep-monthly", spec.keepMonthly);
  tier("--keep-yearly", spec.keepYearly);
  if (spec.keepWithinDays != null && spec.keepWithinDays > 0) {
    args.push("--keep-within", `${spec.keepWithinDays}d`);
  }
  args.push("--prune", "--json");
  return args;
}

/** Quote a value as a TOML basic string (escapes `\`, `"`, and controls). */
export function tomlString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

/** Does a rustic failure read as "wrong repository password"? Drives the
 *  keyring-candidate fallback; deliberately narrow so real errors surface. */
export function isPasswordError(message: string): boolean {
  return /incorrect password|wrong password|no suitable key found|key.*could not be decrypted/i.test(
    message,
  );
}
