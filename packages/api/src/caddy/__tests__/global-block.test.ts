import { describe, expect, test } from "vite-plus/test";

import { buildGlobalBlock } from "../global-block";

const base = {
  adminLine: "admin unix//run/caddy-admin/admin.sock|0600",
  acmeEmail: "ops@example.com",
  layer4Routes: [],
};

const staging = "https://acme-staging-v02.api.letsencrypt.org/directory";

describe("buildGlobalBlock: ACME CA override", () => {
  test("unset ⇒ the block is exactly what it was before the override existed", () => {
    expect(buildGlobalBlock({ ...base, anyUsesAcme: true })).toEqual([
      "{",
      "\tadmin unix//run/caddy-admin/admin.sock|0600",
      "\temail ops@example.com",
      "}",
    ]);
  });

  test("directory only ⇒ acme_ca right after the registration email", () => {
    expect(
      buildGlobalBlock({ ...base, anyUsesAcme: true, acmeCa: { directory: staging } }),
    ).toEqual([
      "{",
      "\tadmin unix//run/caddy-admin/admin.sock|0600",
      "\temail ops@example.com",
      `\tacme_ca ${staging}`,
      "}",
    ]);
  });

  test("directory + root ⇒ acme_ca_root follows acme_ca", () => {
    const lines = buildGlobalBlock({
      ...base,
      anyUsesAcme: true,
      acmeCa: { directory: "https://pebble:14000/dir", root: "/etc/caddy/pebble.minica.pem" },
    });
    expect(lines).toEqual([
      "{",
      "\tadmin unix//run/caddy-admin/admin.sock|0600",
      "\temail ops@example.com",
      "\tacme_ca https://pebble:14000/dir",
      "\tacme_ca_root /etc/caddy/pebble.minica.pem",
      "}",
    ]);
  });

  test("no ACME route ⇒ the override is not emitted (local_certs install untouched)", () => {
    const lines = buildGlobalBlock({
      ...base,
      anyUsesAcme: false,
      acmeCa: { directory: staging, root: "/etc/caddy/ca.pem" },
    });
    expect(lines.join("\n")).not.toContain("acme_ca");
    expect(lines).toContain("\tlocal_certs");
  });
});
