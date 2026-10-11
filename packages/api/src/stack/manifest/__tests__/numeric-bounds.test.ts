/**
 * Every numeric field in the manifest has an upper bound.
 *
 * This is a structural test rather than a list of cases, because the failure it
 * guards is one of omission: a new `z.number().int().positive()` looks complete,
 * reads as validated, and silently joins the class this test exists to keep
 * empty. Enumerating the schema means a field added next month is covered
 * without anyone remembering to come back here.
 *
 * The class, when it was found: 23 of the 25 numeric fields had a lower bound
 * and no upper one. `memoryMb: 1e15`, `replicas: 1e9` and `intervalMs` in days
 * all parsed cleanly and then failed against docker — somewhere that could not
 * name the field, long after the operator had moved on. A cap is not a claim
 * about what a host can afford; it is the line past which the number is
 * certainly a typo (bytes entered as megabytes, seconds as milliseconds).
 */
import { describe, expect, it } from "vite-plus/test";

import { manifestSchema } from "../schema";

interface Leaf {
  path: string;
  hasUpperBound: boolean;
}

/** Every non-null object is soundly readable as a string-keyed bag of unknowns,
 *  which is all the dynamic reads below need. A real predicate, so no assertion
 *  is required to walk zod's internals. Mirrors `isUnknownRecord` in
 *  routers/env/errors.ts. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Zod v4 keeps the definition on `_zod.def`; older nodes expose `_def`. */
function definitionOf(schema: unknown): Record<string, unknown> | undefined {
  if (!isRecord(schema)) return undefined;
  const zod = schema._zod;
  const fromZod = isRecord(zod) ? zod.def : undefined;
  const def = fromZod ?? schema._def;
  return isRecord(def) ? def : undefined;
}

function checkNamesOf(def: Record<string, unknown>): string[] {
  const checks = def.checks;
  if (!Array.isArray(checks)) return [];
  return checks.map((check: unknown) => {
    const inner = definitionOf(check) ?? (isRecord(check) ? check : {});
    const name = inner.check ?? inner.kind;
    return typeof name === "string" ? name : "";
  });
}

/** Walk the schema to its numeric leaves, recording whether each is capped.
 *  Union branches collapse to one path: the same field repeated across the
 *  image/git/upload variants is one field to fix. */
function numericLeaves(schema: unknown, path = "", depth = 0, into: Leaf[] = []): Leaf[] {
  if (depth > 12) return into;
  const def = definitionOf(schema);
  if (!def) return into;
  // Only a string discriminator is meaningful; anything else is not a node
  // kind we know how to walk. Checked rather than stringified, which would
  // turn an object into "[object Object]" and silently match nothing.
  const raw = def.type ?? def.typeName;
  const type = typeof raw === "string" ? raw : "";

  if (type === "object") {
    const rawShape = def.shape;
    const shape = typeof rawShape === "function" ? rawShape() : rawShape;
    if (isRecord(shape)) {
      for (const [key, child] of Object.entries(shape)) {
        numericLeaves(child, path ? `${path}.${key}` : key, depth + 1, into);
      }
    }
    return into;
  }
  // Wrappers that do not change the path.
  if (["optional", "nullable", "default", "readonly", "pipe", "nonoptional"].includes(type)) {
    return numericLeaves(def.innerType ?? def.in ?? def.out, path, depth + 1, into);
  }
  if (type === "array") {
    return numericLeaves(def.element ?? def.valueType, `${path}[]`, depth + 1, into);
  }
  if (type === "record") return numericLeaves(def.valueType, `${path}.<key>`, depth + 1, into);
  if (type === "union") {
    for (const option of Array.isArray(def.options) ? def.options : []) {
      numericLeaves(option, path, depth + 1, into);
    }
    return into;
  }

  if (type === "number") {
    const checks = checkNamesOf(def);
    into.push({
      path,
      hasUpperBound: checks.some((name) => name === "less_than" || name === "max"),
    });
  }
  return into;
}

describe("manifest numeric bounds", () => {
  const leaves = numericLeaves(manifestSchema);

  it("finds the numeric fields at all (guards the walker itself)", () => {
    // If the walker silently stops working — a zod internals change, say — the
    // assertion below would pass on an empty list and the real check would be
    // gone. Pin a floor so the guard cannot rot into a no-op.
    expect(new Set(leaves.map((leaf) => leaf.path)).size).toBeGreaterThanOrEqual(20);
  });

  it("caps every one of them", () => {
    const uncapped = [
      ...new Set(leaves.filter((leaf) => !leaf.hasUpperBound).map((leaf) => leaf.path)),
    ].sort();

    // A field listed here accepts any magnitude. Add `.max(...)` with a comment
    // saying what makes the value certainly wrong, rather than removing it here.
    expect(uncapped).toEqual([]);
  });
});
