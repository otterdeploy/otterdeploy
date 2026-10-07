/**
 * Raw per-route Caddy directives are CONSTRAINED, not removed.
 *
 * The raw-directive feature stays: operators can write `header`, `redir`,
 * `rewrite`, `reverse_proxy` to their own services and so on. What a directive
 * must not reach is the edge's own control surface (the Caddy admin API, its
 * certificate and config directories). Caddy's /adapt pass accepts any valid
 * Caddyfile, so `customDirectivesSchema` checks reach as well as structure.
 *
 * Two boundaries are exercised per case: the write schema (the oRPC contract
 * parses `directives` through it) and `customDirectiveLines`, the builder's
 * re-validation of stored text before it is spliced into the Caddyfile.
 *
 * One test per refused variant, so each rule is pinned on its own. The
 * ordinary cases must keep passing: the rules constrain the feature, they do
 * not remove it.
 */
import { customDirectivesSchema } from "@otterdeploy/shared/custom-directives";
import { describe, expect, it } from "vite-plus/test";

import { customDirectiveLines } from "../custom-directives";

function accepted(text: string): boolean {
  return customDirectivesSchema.safeParse(text).success && customDirectiveLines(text).length > 0;
}

function rejectedEverywhere(text: string): boolean {
  return !customDirectivesSchema.safeParse(text).success && customDirectiveLines(text).length === 0;
}

describe("raw directives cannot reach Caddy's admin surface", () => {
  it("reverse_proxy to the admin unix socket is rejected", () => {
    expect(rejectedEverywhere("reverse_proxy unix//run/caddy-admin/admin.sock")).toBe(true);
  });

  it("reverse_proxy to the admin socket nested in a handle block is rejected", () => {
    expect(
      rejectedEverywhere(
        "handle_path /ops/* {\n\treverse_proxy unix//run/caddy-admin/admin.sock\n}",
      ),
    ).toBe(true);
  });

  it("reverse_proxy to localhost:2019 (the admin port) is rejected", () => {
    expect(rejectedEverywhere("reverse_proxy localhost:2019")).toBe(true);
  });

  it("reverse_proxy to 127.0.0.1:2019 (the admin port) is rejected", () => {
    expect(rejectedEverywhere("reverse_proxy 127.0.0.1:2019")).toBe(true);
  });

  it("reverse_proxy to http://[::1]:2019 (the admin port) is rejected", () => {
    expect(rejectedEverywhere("reverse_proxy http://[::1]:2019")).toBe(true);
  });

  it("file_server rooted at /etc/caddy is rejected", () => {
    expect(rejectedEverywhere("root * /etc/caddy\nfile_server browse")).toBe(true);
  });

  it("file_server rooted at /data (Caddy's cert + key store) is rejected", () => {
    expect(rejectedEverywhere("file_server {\n\troot /data\n}")).toBe(true);
  });

  it("import of an absolute path on the edge host is rejected", () => {
    expect(rejectedEverywhere("import /etc/caddy/Caddyfile")).toBe(true);
  });
});

describe("ordinary raw directives keep working (the feature stays)", () => {
  it.each([
    ["a response header", 'header X-Robots-Tag "noindex"'],
    ["a header block", "header {\n\tX-Frame-Options DENY\n\t-Server\n}"],
    ["a redirect", "redir /old /new 301"],
    ["a rewrite with a placeholder", "rewrite /api/* /v2{uri}"],
    ["reverse_proxy to a normal service name", "reverse_proxy /api/* od-shop-api:8080"],
    ["compression", "encode gzip zstd"],
    ["an error handler", 'handle_errors {\n\trespond "oops" 502\n}'],
  ])("%s is accepted", (_label, text) => {
    expect(accepted(text)).toBe(true);
  });
});
