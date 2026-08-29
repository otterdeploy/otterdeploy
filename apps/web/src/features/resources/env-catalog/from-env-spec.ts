/**
 * Turn a template's `.env.schema` (@env-spec) into env-catalog suggestions.
 *
 * This is the bridge that makes the schema something the operator FEELS
 * rather than a CI gate: every declared key becomes autocomplete in both
 * variables editors, its comment becomes the description, `@sensitive`
 * masks it on pick, `@required` badges it, `@docs` links to where the value
 * comes from, and `@type` becomes the row's shape check.
 *
 * Why derive the catalog from the schema rather than maintain both: they
 * would drift. The schema is already gated against the compose file; hanging
 * the editor off the same artifact means one edit updates the gate, the
 * autocomplete, and the validation together.
 */
import { parseEnvSpecDotEnvFile } from "@env-spec/parser";

import type { EnvIssue, EnvSuggestion } from "./types";

import { checkForType } from "./env-spec-types";

/** A value the editor cannot judge: it resolves at deploy time. */
const HAS_REF = /\$\{\{[^}]+\}\}|\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}/;

/** Raw `KEY=value` text by key — the value as WRITTEN. The parser normalises
 *  a mixed value into `concat(…)`, which is right for evaluation and wrong
 *  for "is this a static default I can prefill". */
export function rawValues(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of source.split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m?.[1] !== undefined) out.set(m[1], (m[2] ?? "").trim());
  }
  return out;
}

/** The URL in `@docs(url)` or `@docs("label", url)`: the last argument. */
function docsUrlOf(decorator: unknown): string | undefined {
  if (typeof decorator !== "object" || decorator === null) return undefined;
  const value: unknown = Reflect.get(decorator, "value");
  if (typeof value !== "object" || value === null) return undefined;
  const data: unknown = Reflect.get(value, "data");
  if (typeof data !== "object" || data === null) return undefined;
  const values: unknown = Reflect.get(data, "values");
  if (!Array.isArray(values)) return undefined;
  const last: unknown = values[values.length - 1];
  if (typeof last !== "object" || last === null) return undefined;
  const url: unknown = Reflect.get(last, "value");
  return typeof url === "string" && /^https?:\/\//.test(url) ? url : undefined;
}

/**
 * The `@type` expression as text: `url`, `enum(a, b)`, `string(minLength=32)`.
 *
 * A bare type arrives pre-simplified; a parameterized one is a parsed node
 * whose own `toString` renders the call back out. Only that override is
 * trusted — falling through to `Object.prototype.toString` would yield
 * "[object Object]" and a validator for a type that doesn't exist.
 */
function typeExprOf(decorator: unknown): string | undefined {
  if (typeof decorator !== "object" || decorator === null) return undefined;
  const simplified: unknown = Reflect.get(decorator, "simplifiedValue");
  if (typeof simplified === "string") return simplified;
  const value: unknown = Reflect.get(decorator, "value");
  if (typeof value !== "object" || value === null) return undefined;
  const render: unknown = Reflect.get(value, "toString");
  if (typeof render !== "function" || render === Object.prototype.toString) return undefined;
  const text: unknown = Reflect.apply(render, value, []);
  return typeof text === "string" ? text : undefined;
}

function validatorFor(required: boolean, typeExpr: string | undefined) {
  const check = typeExpr ? checkForType(typeExpr) : null;
  return (value: string): EnvIssue | null => {
    const v = value.trim();
    if (HAS_REF.test(v)) return null;
    if (v === "") return required ? { level: "block", message: "required" } : null;
    if (!check) return null;
    const failed = check(v);
    if (!failed) return null;
    // Warn-only by default; a REQUIRED value that is malformed blocks, because
    // deploying it produces a container that starts and cannot work.
    return { level: required ? "block" : "warn", message: failed };
  };
}

/** Every declared item as a suggestion, in schema order. */
export function suggestionsFromEnvSpec(source: string): EnvSuggestion[] {
  const parsed = parseEnvSpecDotEnvFile(source);
  const raw = rawValues(source);
  const out: EnvSuggestion[] = [];
  for (const item of parsed.configItems ?? []) {
    const key = item.key;
    if (!key) continue;
    const decorators: Record<string, unknown> = item.decoratorsObject ?? {};
    const required = "required" in decorators;
    const secret = "sensitive" in decorators;
    const rawValue = raw.get(key) ?? "";
    const description = (item.description ?? "").trim();
    const typeExpr = typeExprOf(decorators.type);
    out.push({
      key,
      description,
      // A static default is safe to prefill; a reference or a secret is not.
      ...(rawValue !== "" && !HAS_REF.test(rawValue) && !secret ? { defaultValue: rawValue } : {}),
      ...(secret ? { secret: true } : {}),
      ...(required ? { required: true } : {}),
      ...(docsUrlOf(decorators.docs) ? { docsUrl: docsUrlOf(decorators.docs) } : {}),
      validate: validatorFor(required, typeExpr),
    });
  }
  return out;
}
