import { allowedHostBind } from "@otterdeploy/api/lib/host-binds";
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

/**
 * The bind gate, pinned against a real candidate.
 *
 * NetBird's combined server is the case that motivated the check: it is an
 * obvious thing to want in the catalog (otterdeploy's private-networking
 * feature otherwise needs a NetBird *cloud* account, which is a SaaS
 * dependency inside a self-host-first product), and its compose file is
 * short. But its combined server is configured by `/etc/netbird/config.yaml`,
 * and environment variables override only part of it.
 *
 * A template shaped like the one below passes every other assertion in this
 * file. Without this gate it would ship, the bind would be dropped at deploy,
 * and the container would come up with no configuration. This test fails if
 * the gate ever stops catching it.
 */
describe("bind gate", () => {
  const netbirdShaped = `name: netbird
services:
  netbird:
    image: netbirdio/netbird-server:latest
    volumes:
      - ./config.yaml:/etc/netbird/config.yaml
      - netbird_data:/var/lib/netbird
    ports:
      - "80"
      - "3478/udp"
    restart: always
volumes:
  netbird_data:
`;

  it("a config-file bind is dropped by the deploy path, so the catalog must refuse it", () => {
    const result = parseCompose(netbirdShaped);
    expect(result.isOk(), result.isErr() ? result.error.message : "").toBe(true);
    if (result.isErr()) return;

    // It parses clean — that is the trap. Nothing about the file is malformed.
    expect(result.value.warnings).toEqual([]);

    const dropped = result.value.services.flatMap((s) =>
      s.volumes
        .filter((m) => m.type === "bind" && (!m.source || !allowedHostBind(m.source)))
        .map((m) => m.target),
    );
    expect(dropped).toEqual(["/etc/netbird/config.yaml"]);
  });
});

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

      // A bind that isn't on the host allowlist is DROPPED at deploy, not
      // honoured and not refused: `toMounts` (stack/compose/to-spec.ts) keeps
      // the mount only when `allowedHostBind` grants it and otherwise skips
      // it. So the container starts, without the file the compose file said
      // it needed, and the failure surfaces as whatever that program does
      // when its config is missing.
      //
      // A `StackTemplate` is a compose file and NOTHING else (types.ts: one
      // `compose` string, no side files), so it cannot even write a
      // `./config.yaml` for a bind to point at. Every other assertion here
      // passes such a template — it parses clean, its services resolve, its
      // env refs line up — and it fails only on the operator's server, which
      // is the one place this contract exists to stop things reaching.
      //
      // This is the gate that rules out otherwise-attractive candidates whose
      // upstream config is file-shaped rather than env-shaped: NetBird's
      // combined server wants `/etc/netbird/config.yaml` and env vars cover
      // only part of it, so it cannot be a template until `StackTemplate`
      // carries files. The resource layer already models them (`ComposeFile[]`,
      // written by `materializeComposeFiles`); it is the catalog type that
      // stops short.
      it("binds only host paths the deploy path actually grants", () => {
        const dropped = parsed.services.flatMap((s) =>
          s.volumes
            .filter((m) => m.type === "bind" && (!m.source || !allowedHostBind(m.source)))
            .map((m) => `${s.name}: ${m.source ?? "?"} → ${m.target}`),
        );
        expect(dropped).toEqual([]);
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
