import { collectVarRefs } from "@otterdeploy/api/routers/compose/env";
import { parseCompose } from "@otterdeploy/api/stack/compose/parse";
/**
 * The catalog honesty gate: every template's compose YAML must round-trip the
 * repo's own compose parser — the exact code path the wizard's live preview
 * and the deploy reconciler use — and the typed metadata (`includes`,
 * `requiredEnv`) must match what the parser actually finds in the file.
 */
import { describe, expect, it } from "vite-plus/test";

import { TEMPLATES } from "./index";

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
            .filter((m) => m.type === "volume" && m.source)
            .map((m) => m.source as string),
        );
        expect([...mounted].sort()).toEqual([...parsed.volumeNames].sort());
      });

      it("carries description, docs URL, and a logo brand", () => {
        expect(template.description.length).toBeGreaterThan(20);
        expect(template.docsUrl).toMatch(/^https:\/\//);
        expect(template.logoBrand.length).toBeGreaterThan(0);
      });
    });
  }
});
