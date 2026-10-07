/**
 * On a multi-org install, DNS is never proof of WHICH org owns a
 * custom host. A record pointing at the install (or a Cloudflare-proxied one,
 * whose addresses every proxied zone shares) only says the zone's owner chose
 * this install, so any org could otherwise claim a name another org's
 * wildcard already points here. There the per-route TXT record is the only
 * proof; a single-org install keeps the add-and-go shortcut.
 */

import { describe, expect, it } from "vite-plus/test";

import { provenByDns } from "../domain-rules";

describe("provenByDns", () => {
  it.each(["pointed", "proxied", "unpointed", "unknown"] as const)(
    "a %s host is never proven by DNS on a multi-org install",
    (state) => {
      expect(provenByDns(state, { multiOrg: true })).toBe(false);
    },
  );

  it("a pointed or proxied host is proven on a single-org install", () => {
    expect(provenByDns("pointed", { multiOrg: false })).toBe(true);
    expect(provenByDns("proxied", { multiOrg: false })).toBe(true);
  });

  it("an unpointed or unknown host is never proven, whatever the install", () => {
    expect(provenByDns("unpointed", { multiOrg: false })).toBe(false);
    expect(provenByDns("unknown", { multiOrg: false })).toBe(false);
  });
});
