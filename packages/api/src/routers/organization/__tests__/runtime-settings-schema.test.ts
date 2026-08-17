/**
 * The Runtime settings card runs this schema inline as the operator types, and
 * the server runs it again on save. These cover the messages the operator
 * actually reads. A wrong-but-passing message is a real defect here, because
 * the whole point of moving validation forward was that "Input validation
 * failed" named neither the field nor the offending entry.
 */
import { describe, expect, it } from "vite-plus/test";

import {
  egressAllowlistField,
  firstInvalidAllowlistEntry,
  runtimeSettingsDraftSchema,
} from "../runtime-settings-schema";

const VALID_DRAFT = {
  egressAllowlist: "192.168.1.10, 10.0.0.0/24",
  previewIdleTeardownHours: 72,
  edgeLogPersist: true,
  edgeLogRetentionDays: 7,
  edgeLogGeoipUrl: "https://cdn.jsdelivr.net/npm/@ip-location-db/dbip-country.mmdb",
  edgeLogGeoipAsnUrl: "https://cdn.jsdelivr.net/npm/@ip-location-db/asn.mmdb",
  builderConcurrency: 1,
};

const messageFor = (draft: typeof VALID_DRAFT, field: string): string | undefined => {
  const parsed = runtimeSettingsDraftSchema.safeParse(draft);
  if (parsed.success) return undefined;
  return parsed.error.issues.find((i) => i.path[0] === field)?.message;
};

describe("egressAllowlistField", () => {
  it("accepts bare IPs and CIDRs, v4 and v6", () => {
    for (const ok of [
      "",
      "192.168.1.10",
      "10.0.0.0/24",
      "fd00::1",
      "fd00::/8",
      "1.2.3.4, ::1/128",
    ]) {
      expect(egressAllowlistField.safeParse(ok).success).toBe(true);
    }
  });

  it("rejects a hostname. It could be rebound to a private address after validation", () => {
    expect(egressAllowlistField.safeParse("internal.acme.com").success).toBe(false);
  });

  it("rejects addresses that are the right SHAPE but out of range", () => {
    // The hand-rolled regex this replaced matched on shape alone and let all
    // of these through to a parser that silently drops what it can't parse.
    // An allowlist that looks like it grants something it doesn't.
    for (const bad of ["999.999.999.999", "1.2.3.4/99", "10.0.0.0/-1", "1.2.3", "1.2.3.4.5"]) {
      expect(egressAllowlistField.safeParse(bad).success).toBe(false);
    }
  });

  it("names the offending entry rather than rejecting the whole line vaguely", () => {
    // The reported screenshot case: one junk token, seven fields, a toast that
    // said only "Input validation failed".
    expect(messageFor({ ...VALID_DRAFT, egressAllowlist: "asssad" }, "egressAllowlist")).toBe(
      '"asssad" is not a bare IP or CIDR. Hostnames are not accepted here',
    );
  });

  it("points at the FIRST bad entry when good and bad are mixed", () => {
    expect(
      messageFor(
        { ...VALID_DRAFT, egressAllowlist: "10.0.0.1, nope, 10.0.0.2" },
        "egressAllowlist",
      ),
    ).toBe('"nope" is not a bare IP or CIDR. Hostnames are not accepted here');
  });

  it("ignores blank entries from trailing commas", () => {
    expect(firstInvalidAllowlistEntry("10.0.0.1, , 10.0.0.2,")).toBeNull();
    expect(egressAllowlistField.safeParse("10.0.0.1, , 10.0.0.2,").success).toBe(true);
  });
});

describe("runtimeSettingsDraftSchema", () => {
  it("accepts a well-formed draft", () => {
    expect(runtimeSettingsDraftSchema.safeParse(VALID_DRAFT).success).toBe(true);
  });

  it("tells the operator a bare host is not a URL", () => {
    expect(
      messageFor({ ...VALID_DRAFT, edgeLogGeoipUrl: "cdn.jsdelivr.net" }, "edgeLogGeoipUrl"),
    ).toBe("must be a full URL, including https://");
  });

  it("keys every issue to its own field, so each row can show its own message", () => {
    const parsed = runtimeSettingsDraftSchema.safeParse({
      ...VALID_DRAFT,
      egressAllowlist: "asssad",
      edgeLogGeoipUrl: "nope",
      builderConcurrency: 99,
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const fields = new Set(parsed.error.issues.map((i) => i.path[0]));
    expect(fields).toEqual(new Set(["egressAllowlist", "edgeLogGeoipUrl", "builderConcurrency"]));
  });

  it("enforces the documented bounds", () => {
    expect(
      runtimeSettingsDraftSchema.safeParse({ ...VALID_DRAFT, builderConcurrency: 0 }).success,
    ).toBe(false);
    expect(
      runtimeSettingsDraftSchema.safeParse({ ...VALID_DRAFT, builderConcurrency: 33 }).success,
    ).toBe(false);
    expect(
      runtimeSettingsDraftSchema.safeParse({ ...VALID_DRAFT, edgeLogRetentionDays: 0 }).success,
    ).toBe(false);
    expect(
      runtimeSettingsDraftSchema.safeParse({ ...VALID_DRAFT, previewIdleTeardownHours: -1 })
        .success,
    ).toBe(false);
    // 0 hours is meaningful here: it disables idle teardown.
    expect(
      runtimeSettingsDraftSchema.safeParse({ ...VALID_DRAFT, previewIdleTeardownHours: 0 }).success,
    ).toBe(true);
  });
});
