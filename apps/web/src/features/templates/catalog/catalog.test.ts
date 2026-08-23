import { allowedHostBind } from "@otterdeploy/api/lib/host-binds";
import { collectVarRefs } from "@otterdeploy/api/routers/compose/env";
import { parseCompose } from "@otterdeploy/api/stack/compose/parse";
import en from "@otterdeploy/i18n/locales/en";
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
 * The English prose, keyed by template id.
 *
 * A widening ANNOTATION, not an assertion: `en.templates.catalog` is inferred
 * as an object with 58 literal keys, and `template.id` is a `string`, so
 * indexing it directly is a TS7053. Declaring the record shape is what lets a
 * missing entry come back `undefined` and be asserted on, which is the whole
 * point of the checks below.
 */
const PROSE: Record<string, { description: string; env?: Record<string, string> }> =
  en.templates.catalog;

/** Stack-relative form of a path, so a compose `./config.yaml` and a shipped
 *  `config.yaml` compare equal (both land at the same place in the tree). */
function stackRel(path: string): string {
  return path.replace(/^\.\/+/, "");
}

/** `${NAME}` refs in a file's content, in source order. */
function varRefs(content: string): string[] {
  return [...content.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].flatMap((m) =>
    m[1] ? [m[1]] : [],
  );
}

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
 * The bind gate, pinned against the case that motivated it.
 *
 * A config-file bind is fine ONLY when something puts a file there. The deploy
 * path is explicit about this: `reconcile-map.ts` drops a non-allowlisted bind
 * when the stack has no materialized tree (`if (!ctx.stackDir) continue`) and
 * otherwise resolves it into the tree. So the same compose file is correct
 * with `files` and broken without them, and the difference is invisible to
 * every other assertion in this suite — it parses clean either way.
 *
 * Both directions are pinned here so a refactor can't collapse them into one.
 */
describe("bind gate", () => {
  const composeWithConfigBind = `name: netbird
services:
  netbird:
    image: netbirdio/netbird-server:0.77.1
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

  const mounts = (compose: string) => {
    const result = parseCompose(compose);
    expect(result.isOk(), result.isErr() ? result.error.message : "").toBe(true);
    if (result.isErr()) return [];
    // It parses clean either way — that is exactly why the gate is needed.
    expect(result.value.warnings).toEqual([]);
    return result.value.services.flatMap((s) => s.volumes);
  };

  it("refuses a config bind when the template ships no file for it", () => {
    const provided = new Set<string>();
    const unbacked = mounts(composeWithConfigBind)
      .filter(
        (m) =>
          m.type === "bind" &&
          (!m.source || (!allowedHostBind(m.source) && !provided.has(stackRel(m.source)))),
      )
      .map((m) => m.target);
    expect(unbacked).toEqual(["/etc/netbird/config.yaml"]);
  });

  it("accepts the same bind once the template ships the file", () => {
    const provided = new Set(["config.yaml"]);
    const unbacked = mounts(composeWithConfigBind)
      .filter(
        (m) =>
          m.type === "bind" &&
          (!m.source || (!allowedHostBind(m.source) && !provided.has(stackRel(m.source)))),
      )
      .map((m) => m.target);
    expect(unbacked).toEqual([]);
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
        const fromCompose = collectVarRefs(parsed)
          .filter((ref) => ref.default === null)
          .map((ref) => ref.name);
        // Refs inside an interpolated file are prompted for exactly like the
        // compose file's own — they resolve from the same variable bag at
        // materialize time. Missing one renders it EMPTY, and an empty
        // encryption key is a silently insecure install, not a loud failure.
        const fromFiles = (template.files ?? [])
          .filter((f) => f.interpolate)
          .flatMap((f) => varRefs(f.content));
        const required = [...new Set([...fromCompose, ...fromFiles])].sort();
        expect(template.requiredEnv.map((v) => v.key).sort()).toEqual(required);
      });

      it("only depends_on services that exist", () => {
        const names = new Set(parsed.services.map((s) => s.name));
        for (const svc of parsed.services) {
          for (const dep of svc.dependsOn)
            expect(names.has(dep), `${svc.name} → ${dep}`).toBe(true);
        }
      });

      // A bind is only real if something puts a file at its source. Two ways
      // that happens: the host allowlist grants the path outright
      // (`/var/run/docker.sock`, for Dozzle), or the template ships the file
      // itself and the deploy materializes it into the stack tree, where
      // `resolveBindSource` (reconcile-map.ts) then resolves the bind.
      //
      // Anything else names a path nothing writes, and `reconcile-map` drops
      // it when the stack has no tree at all — so the container starts WITHOUT
      // the file its compose said it needed and fails as whatever that program
      // does with no config, on the operator's server, which is the one place
      // this contract exists to stop things reaching. Every other assertion
      // here would pass it: it parses clean, its services resolve, its env
      // refs line up.
      it("binds only paths something actually provides", () => {
        const provided = new Set((template.files ?? []).map((f) => stackRel(f.path)));
        const unbacked = parsed.services.flatMap((s) =>
          s.volumes
            .filter(
              (m) =>
                m.type === "bind" &&
                (!m.source || (!allowedHostBind(m.source) && !provided.has(stackRel(m.source)))),
            )
            .map((m) => `${s.name}: ${m.source ?? "?"} → ${m.target}`),
        );
        expect(unbacked).toEqual([]);
      });

      // A shipped file is inert unless the compose mounts it, and a stray one
      // is how a template ends up looking configured while running on defaults.
      it("mounts every file it ships", () => {
        const mounted = new Set(
          parsed.services.flatMap((s) =>
            s.volumes.flatMap((m) => (m.type === "bind" && m.source ? [stackRel(m.source)] : [])),
          ),
        );
        for (const f of template.files ?? []) {
          expect(mounted.has(stackRel(f.path)), `unmounted file ${f.path}`).toBe(true);
        }
      });

      // Interpolation is opt-in per file and has to stay that way — a script's
      // literal `${HOME}` must survive. The corollary: a file carrying refs
      // WITHOUT the flag ships them as the literal text `${VAR}`, which is its
      // own quiet breakage.
      it("does not ship un-flagged files containing ${VAR}", () => {
        for (const f of template.files ?? []) {
          if (f.interpolate) continue;
          expect(varRefs(f.content), `${f.path} has refs but no interpolate flag`).toEqual([]);
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

      // The keys are `TranslationKey`s, so a typo is already a compile error.
      // What tsc cannot see is an EMPTY or stub entry, which renders as blank
      // space in the gallery rather than as anything anyone would notice.
      it("carries description, docs URL, and a logo brand", () => {
        expect(PROSE[template.id]?.description.length ?? 0).toBeGreaterThan(20);
        expect(template.docsUrl).toMatch(/^https:\/\//);
        expect(template.logoBrand.length).toBeGreaterThan(0);
      });

      // Key paths are built from the template id and each env key, so they go
      // stale the moment either is renamed — and a stale key renders its own
      // dotted path at the operator, which is the failure this catches.
      it("points every description key at prose that exists", () => {
        const entry = PROSE[template.id];
        expect(entry, `no templates.catalog.${template.id} in en.json`).toBeDefined();
        expect(template.descriptionKey).toBe(`templates.catalog.${template.id}.description`);
        for (const v of template.requiredEnv) {
          expect(v.descriptionKey).toBe(`templates.catalog.${template.id}.env.${v.key}`);
          expect(entry?.env?.[v.key], `no prose for ${template.id}.env.${v.key}`).toBeTruthy();
        }
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
