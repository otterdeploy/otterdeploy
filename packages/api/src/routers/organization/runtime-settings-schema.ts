/**
 * Field schemas for the Runtime settings card, in their own module so the web
 * app can import them without pulling the oRPC contract (and its transitive
 * server surface) into the browser bundle.
 *
 * These exist as named per-field exports rather than only as one object schema
 * because the settings form validates each field AS IT IS TYPED. Validating a
 * bare IP list is not worth a network round trip, and "Input validation
 * failed" arriving as a toast after Save tells the operator nothing about
 * which of seven fields is wrong. The rule this encodes: the client and the
 * server run the SAME schema, so the client can be honest immediately and the
 * server stays the authority — never two hand-written validators that drift.
 *
 * `zod` only. Nothing here may import a server module, or the import is no
 * longer safe from the browser.
 */

import * as z from "zod";

/**
 * One allowlist entry: a bare IPv4/IPv6 address or a CIDR block.
 *
 * Hostnames are deliberately unmatched — a name that resolves to a public
 * address at validation time can be re-bound to a private one afterwards,
 * which is the whole SSRF this allowlist has to not reopen.
 *
 * Zod's validators rather than a hand-rolled regex: the regex this replaced
 * matched on shape alone, so it accepted `999.999.999.999` and `1.2.3.4/99`
 * and passed them to a parser that drops unparseable entries by design
 * (../../security/trusted-proxy.ts). An allowlist that appears to grant
 * something it doesn't is worse than one that rejects the typo up front.
 */
const ipOrCidrField = z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()]);

/** The entries of a comma-separated allowlist, blanks dropped. Exported so the
 *  form can point at the FIRST bad entry instead of rejecting the whole line. */
function allowlistEntries(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** The first entry that isn't a bare IP/CIDR, or null when all are valid. */
export function firstInvalidAllowlistEntry(raw: string): string | null {
  return allowlistEntries(raw).find((entry) => !ipOrCidrField.safeParse(entry).success) ?? null;
}

/** Comma-separated; empty string = explicitly allow nothing. */
export const egressAllowlistField = z
  .string()
  .trim()
  .superRefine((raw, ctx) => {
    // superRefine, not refine, because the message names the offending entry —
    // "asssad is not a bare IP" is actionable, "Invalid input" is not, and
    // refine's second argument cannot depend on the value.
    const bad = firstInvalidAllowlistEntry(raw);
    if (bad === null) return;
    ctx.addIssue({
      code: "custom",
      message: `"${bad}" is not a bare IP or CIDR — hostnames are not accepted here`,
    });
  });

const previewIdleTeardownHoursField = z.number().int().min(0).max(8760);
const edgeLogRetentionDaysField = z.number().int().min(1).max(365);
const geoipUrlField = z.url({ message: "must be a full URL, including https://" });
const builderConcurrencyField = z.number().int().min(1).max(32);

/** The operator-editable half of the Runtime card — everything the Save button
 *  sends, minus the organization id the contract adds. The web form validates
 *  against exactly this. */
export const runtimeSettingsDraftSchema = z.object({
  egressAllowlist: egressAllowlistField,
  previewIdleTeardownHours: previewIdleTeardownHoursField,
  edgeLogPersist: z.boolean(),
  edgeLogRetentionDays: edgeLogRetentionDaysField,
  edgeLogGeoipUrl: geoipUrlField,
  edgeLogGeoipAsnUrl: geoipUrlField,
  builderConcurrency: builderConcurrencyField,
});

export type RuntimeSettingsDraft = z.infer<typeof runtimeSettingsDraftSchema>;
