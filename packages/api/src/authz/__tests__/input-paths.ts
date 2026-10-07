/**
 * Every field path a procedure's input schema can carry (read from the real
 * contract schema through zod's JSON Schema), and which of them must be
 * classified for API-key project scope (../project-refs.ts). `*` stands for
 * every array element or record value.
 */
import * as z from "zod";

import type { ProjectRefs } from "../project-refs";

import { ID_LIKE_FIELD, fieldRef } from "../project-refs";

const node = z.object({
  properties: z.record(z.string(), z.unknown()).optional(),
  items: z.unknown().optional(),
  additionalProperties: z.unknown().optional(),
  anyOf: z.array(z.unknown()).optional(),
  oneOf: z.array(z.unknown()).optional(),
  allOf: z.array(z.unknown()).optional(),
});

function collect(raw: unknown, prefix: readonly string[], out: Set<string>, depth: number): void {
  const parsed = node.safeParse(raw);
  if (!parsed.success || depth > 10) return;
  const schema = parsed.data;
  for (const variant of [...(schema.anyOf ?? []), ...(schema.oneOf ?? []), ...(schema.allOf ?? [])])
    collect(variant, prefix, out, depth + 1);
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    const path = [...prefix, name];
    out.add(path.join("."));
    collect(child, path, out, depth + 1);
  }
  if (schema.items !== undefined) collect(schema.items, [...prefix, "*"], out, depth + 1);
  if (typeof schema.additionalProperties === "object")
    collect(schema.additionalProperties, [...prefix, "*"], out, depth + 1);
}

/** Every property path of an input schema (empty for a schemaless procedure). */
export function inputPaths(schema: unknown): ReadonlySet<string> {
  const out = new Set<string>();
  if (!(schema instanceof z.ZodType)) return out;
  collect(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }), [], out, 0);
  return out;
}

/** The id-like paths of `paths` that the declaration leaves unclassified:
 *  a top-level field needs a convention or a declaration, a nested one an
 *  explicit declaration of its full path. */
export function unclassifiedPaths(paths: ReadonlySet<string>, declared: ProjectRefs): string[] {
  return [...paths].filter((path) => {
    const leaf = path.split(".").at(-1) ?? path;
    if (!ID_LIKE_FIELD.test(leaf)) return false;
    return path.includes(".")
      ? !Object.hasOwn(declared, path)
      : fieldRef(path, declared) === undefined;
  });
}
