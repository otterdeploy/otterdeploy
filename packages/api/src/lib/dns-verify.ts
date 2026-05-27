/**
 * DNS TXT-record verification. Used to prove the operator controls a
 * domain before otterstack writes a Caddy/ACME route for it — without
 * this gate, anyone could type someone else's domain into the settings
 * page and trigger a Let's Encrypt cert request for a name they don't
 * own. (Rate-limited at the ACME side, but still noise the operator
 * shouldn't be able to create.)
 *
 * We use a TXT record (Vercel/Railway/Render pattern) instead of an
 * A-record check (Coolify's approach) because TXT proves intent —
 * an A record might already be pointing at the install for unrelated
 * reasons (CDN, shared IP, etc.) and shouldn't grant publishing rights.
 */

import { promises as dns } from "node:dns";

export const VERIFY_TXT_PREFIX = "_otterstack-verify";

export interface VerifyOutcome {
  ok: boolean;
  /** What we looked up — surfaces in the UI so the operator knows the
   *  exact record name to add to their DNS. */
  recordName: string;
  /** What we expected the TXT value to be. */
  expected: string;
  /** Every TXT value the resolver returned for that name. Lets the UI
   *  render "we saw <X>, expected <Y>" diagnostics instead of just
   *  saying "no match". */
  found: string[];
  /** Reason for failure when !ok. */
  reason:
    | "ok"
    | "no-record"
    | "value-mismatch"
    | "lookup-failed"
    | "missing-token";
  /** Underlying error message when reason === "lookup-failed". */
  errorMessage?: string;
}

export async function verifyDomainTxt(input: {
  domain: string;
  expectedToken: string | null;
}): Promise<VerifyOutcome> {
  const recordName = `${VERIFY_TXT_PREFIX}.${input.domain}`;
  if (!input.expectedToken) {
    return {
      ok: false,
      recordName,
      expected: "",
      found: [],
      reason: "missing-token",
    };
  }

  try {
    // resolveTxt returns each record as an array of strings (DNS TXT
    // chunks); join them per record before comparing.
    const raw = await dns.resolveTxt(recordName);
    const found = raw.map((chunks) => chunks.join(""));
    if (found.length === 0) {
      return {
        ok: false,
        recordName,
        expected: input.expectedToken,
        found,
        reason: "no-record",
      };
    }
    if (found.includes(input.expectedToken)) {
      return {
        ok: true,
        recordName,
        expected: input.expectedToken,
        found,
        reason: "ok",
      };
    }
    return {
      ok: false,
      recordName,
      expected: input.expectedToken,
      found,
      reason: "value-mismatch",
    };
  } catch (err) {
    // ENOTFOUND, ENODATA, etc. all collapse to "we couldn't find the
    // record yet". The caller surfaces this to the UI as "DNS hasn't
    // propagated; try again in a minute."
    const code = (err as { code?: string }).code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return {
        ok: false,
        recordName,
        expected: input.expectedToken,
        found: [],
        reason: "no-record",
      };
    }
    return {
      ok: false,
      recordName,
      expected: input.expectedToken,
      found: [],
      reason: "lookup-failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
