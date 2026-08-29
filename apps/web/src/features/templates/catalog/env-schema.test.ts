/**
 * The env-schema gate.
 *
 * Companion to catalog.test.ts, which proves a template's compose PARSES.
 * This proves its environment is COHERENT: that the schema and the compose
 * agree about every key, and — the load-bearing one — that no value
 * otterdeploy can derive has been frozen into a literal.
 *
 * This is the check that would have caught the Postiz template shipping
 * `MAIN_URL: ${POSTIZ_URL}`, where POSTIZ_URL was a snapshot of the generated
 * host taken at install. It deployed clean, passed every existing gate, and
 * broke the moment anyone renamed the domain.
 */
import { parseEnvSpecDotEnvFile } from "@env-spec/parser";
import { parseCompose } from "@otterdeploy/api/stack/compose/parse";
import { describe, expect, it } from "vite-plus/test";

import { ENV_SCHEMAS } from "./env-schemas";
import { TEMPLATES } from "./index";

/** An otterdeploy cross-resource ref: `${{stack.db.HOST}}`. Its presence in a
 *  schema value is what makes an item platform-owned. */
const OTTERDEPLOY_REF = /\$\{\{[^}]+\}\}/;

interface SchemaItem {
  key: string;
  /** The value exactly as WRITTEN in the schema.
   *
   *  Deliberately the raw source line rather than the parser's rendering: a
   *  value mixing both ref syntaxes (`postgres://u:${PW}@${{stack.db.HOST}}/x`)
   *  normalizes to `concat(…, ref(PW), …)`, which is a faithful parse and
   *  useless for comparing against the compose text it has to match. The
   *  parser is still what reads the decorators; only the comparison needs
   *  source fidelity. */
  value: string;
  required: boolean;
}

/** Raw `KEY=value` text, by key. Single-line values only, which is all any
 *  template schema uses; a multi-line value would simply not be covered. */
function rawValues(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of source.split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m?.[1] !== undefined) out.set(m[1], (m[2] ?? "").trim());
  }
  return out;
}

function itemsOf(source: string): SchemaItem[] {
  const parsed = parseEnvSpecDotEnvFile(source);
  const raw = rawValues(source);
  return (parsed.configItems ?? []).flatMap((item) => {
    const key = item.key;
    if (!key) return [];
    return [
      {
        key,
        value: raw.get(key) ?? "",
        required: "required" in (item.decoratorsObject ?? {}),
      },
    ];
  });
}

describe("template env schemas", () => {
  for (const [templateId, source] of Object.entries(ENV_SCHEMAS)) {
    describe(templateId, () => {
      const template = TEMPLATES.find((t) => t.id === templateId);
      const items = itemsOf(source);
      const byKey = new Map(items.map((i) => [i.key, i]));

      it("is a template that exists", () => {
        expect(template, `no template with id ${templateId}`).toBeDefined();
      });

      // A schema that does not parse is worse than none: every check below
      // would silently pass on an empty item list.
      it("parses as @env-spec and declares items", () => {
        expect(items.length).toBeGreaterThan(0);
      });

      it("declares every env key the compose sets", () => {
        if (!template) return;
        const parsed = parseCompose(template.compose);
        expect(parsed.isOk()).toBe(true);
        if (!parsed.isOk()) return;
        const undeclared: string[] = [];
        for (const svc of parsed.value.services) {
          for (const key of Object.keys(svc.env)) {
            if (!byKey.has(key)) undeclared.push(`${svc.name}.${key}`);
          }
        }
        expect(undeclared).toEqual([]);
      });

      // THE RULE. A schema value carrying an otterdeploy ref declares that
      // otterdeploy owns that value. The compose must then use the SAME ref:
      // a literal there is a value that stops tracking whatever produced it.
      it("never freezes a platform-owned value into a literal", () => {
        if (!template) return;
        const parsed = parseCompose(template.compose);
        if (!parsed.isOk()) return;
        const frozen: string[] = [];
        for (const svc of parsed.value.services) {
          for (const [key, value] of Object.entries(svc.env)) {
            const declared = byKey.get(key);
            if (!declared || !OTTERDEPLOY_REF.test(declared.value)) continue;
            if (value !== declared.value) {
              frozen.push(`${svc.name}.${key}: expected "${declared.value}", got "${value}"`);
            }
          }
        }
        expect(frozen).toEqual([]);
      });

      // requiredEnv is what the wizard PROMPTS for. Anything it asks the
      // operator to supply has to be a key the schema knows about, or the
      // prompt and the validation are describing different variables.
      it("declares every key the wizard prompts for", () => {
        if (!template) return;
        const unknown = template.requiredEnv.map((v) => v.key).filter((k) => !byKey.has(k));
        expect(unknown).toEqual([]);
      });
    });
  }
});
