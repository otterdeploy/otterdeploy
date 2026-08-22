import { collectVarRefs } from "@otterdeploy/api/routers/compose/env";
import { parseCompose } from "@otterdeploy/api/stack/compose/parse";
/**
 * The catalog honesty gate: every template's compose YAML must round-trip the
 * repo's own compose parser. The exact code path the wizard's live preview
 * and the deploy reconciler use, and the typed metadata (`includes`,
 * `requiredEnv`) must match what the parser actually finds in the file.
 */
import { describe, expect, it } from "vite-plus/test";

import { hasBrandMark } from "@/shared/components/brand/svgl-logo";

import { TEMPLATES } from "./index";

/** Keys whose bare value IS a hostname (`DB_HOST: db`). Without this, a
 *  username that happens to match a service name (`POSTGRES_USER: umami` in
 *  the umami stack) reads as a host reference. */
const HOST_KEY = /(host|hostname|addr|address|seeds|endpoint)s?$/i;

/**
 * Every hostname an env value points at: the authority of each `//…` URL
 * (userinfo stripped, so the `postgres` in `postgres://postgres:pw@db/x` is
 * not mistaken for a host), plus a bare `host` / `host:port` value under a
 * host-shaped key.
 */
function hostsIn(key: string, value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(/\/\/([^/\s"']*)/g)) {
    const authority = m[1] ?? "";
    const at = authority.lastIndexOf("@");
    const host = (at >= 0 ? authority.slice(at + 1) : authority).split(/[:?#]/)[0];
    if (host) out.push(host);
  }
  const bare = /^([A-Za-z0-9_.-]+)(?::\d+)?$/.exec(value.trim());
  if (bare?.[1] && HOST_KEY.test(key)) out.push(bare[1]);
  return out;
}

describe("template catalog", () => {
  it("has unique ids and a non-trivial catalog", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  });

  for (const template of TEMPLATES) {
    describe(template.id, () => {
      const result = parseCompose(template.compose);

      it("parses with the repo's compose parser, with zero warnings", () => {
        expect(result.isOk(), result.isErr() ? result.error.message : "").toBe(true);
        if (result.isErr()) return;
        expect(result.value.warnings).toEqual([]);
      });

      if (result.isErr()) return;
      const parsed = result.value;

      it("declares `includes` exactly matching the parsed service names", () => {
        expect([...template.includes].sort()).toEqual(parsed.services.map((s) => s.name).sort());
      });

      it("uses images only (no build contexts) so it deploys without a repo", () => {
        for (const svc of parsed.services) {
          expect(svc.image, `service ${svc.name}`).toBeTruthy();
          expect(svc.build, `service ${svc.name}`).toBeNull();
        }
      });

      it("exposes at least one service port for routing", () => {
        expect(parsed.services.some((s) => s.ports.length > 0)).toBe(true);
      });

      it("declares `requiredEnv` exactly matching the file's required ${VAR} refs", () => {
        const required = collectVarRefs(parsed)
          .filter((ref) => ref.default === null)
          .map((ref) => ref.name)
          .sort();
        expect(template.requiredEnv.map((v) => v.key).sort()).toEqual(required);
      });

      it("only depends_on services that exist", () => {
        const names = new Set(parsed.services.map((s) => s.name));
        for (const svc of parsed.services) {
          for (const dep of svc.dependsOn)
            expect(names.has(dep), `${svc.name} → ${dep}`).toBe(true);
        }
      });

      it("declares every named volume it mounts (and mounts every declared one)", () => {
        const mounted = new Set(
          parsed.services
            .flatMap((s) => s.volumes)
            .flatMap((m) => (m.type === "volume" && m.source ? [m.source] : [])),
        );
        expect([...mounted].sort()).toEqual([...parsed.volumeNames].sort());
      });

      it("addresses sibling services by stack ref, never by bare compose name", () => {
        // A child's real hostname is the bare compose name ONLY for the first
        // stack to claim it on the shared network; the second instance becomes
        // `<stack>-<name>` (see pickInternalHostname). A template hardcoding
        // `db:5432` therefore works once and then silently points the second
        // copy at the FIRST copy's database. `${{stack.db.HOST}}` resolves per
        // stack, so it survives both the rename and a second instance.
        const siblings = new Set(parsed.services.map((s) => s.name));
        const violations: string[] = [];
        for (const svc of parsed.services) {
          for (const [key, value] of Object.entries(svc.env)) {
            for (const host of hostsIn(key, value)) {
              if (siblings.has(host) && host !== svc.name) {
                violations.push(`${svc.name}.${key} → "${host}" (${value})`);
              }
            }
          }
        }
        expect(violations).toEqual([]);
      });

      it("carries description, docs URL, and a logo brand", () => {
        expect(template.description.length).toBeGreaterThan(20);
        expect(template.docsUrl).toMatch(/^https:\/\//);
        expect(template.logoBrand.length).toBeGreaterThan(0);
      });

      // A `logoBrand` with no mark behind it doesn't fail anything at runtime:
      // SvglLogo falls back to a grey initial, so the row still renders and the
      // gap only shows up as a wall of `A`s and `B`s in the gallery. Assert the
      // mark exists so a template can't land without one.
      it("has a registered mark, not a letter fallback", () => {
        expect(hasBrandMark(template.logoBrand)).toBe(true);
      });
    });
  }
});
