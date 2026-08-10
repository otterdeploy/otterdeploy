/**
 * Planning a clone of a SET of resources.
 *
 * Cloning one resource is copying a row. Cloning a set is a different problem,
 * and this module exists for the difference: env values reference other
 * resources by NAME (`${{db.DATABASE_URL}}`, see lib/variables/parser). Copy
 * those values verbatim and the cloned service points at the ORIGINAL
 * database. It deploys, it connects, it works, and it writes to production.
 * Nothing in the runtime treats that as an error, and the operator has no
 * reason to suspect it, which makes it the single most dangerous thing a naive
 * clone can do.
 *
 * So references are rewritten when their target is inside the set, and left
 * exactly alone when it isn't. Both are correct and neither is guessable:
 *
 *   - target inside the set  → rewrite to the clone. A cloned stack should be
 *     self-contained, or it isn't a clone.
 *   - target outside the set → keep. The operator chose not to clone that
 *     resource, so pointing at the original is what they asked for. It is
 *     still REPORTED, because "this copy shares your production Redis" is
 *     something you want to know before you deploy it, not after.
 *
 * Everything here is pure. The whole point is that this is assertable without
 * a database.
 */

import { parseValue } from "../../../lib/variables/parser";

export interface CloneSource {
  resourceId: string;
  name: string;
  type: "service" | "database" | "compose";
}

export interface ClonePlanItem {
  resourceId: string;
  /** Original name, as referenced by other resources' env values. */
  sourceName: string;
  /** Collision-free name for the copy. */
  targetName: string;
}

export interface ExternalRef {
  /** The clone that carries this reference. */
  fromName: string;
  /** The resource it points at, which is NOT being cloned. */
  toName: string;
  /** The env key holding it, so the report can name the exact line. */
  envKey: string;
}

export interface ClonePlan {
  items: ClonePlanItem[];
  /** name → name, for rewriting refs within the set. */
  rename: Map<string, string>;
  /** References that will still point at the originals. Not errors. */
  externalRefs: ExternalRef[];
}

/**
 * A collision-free name for a copy.
 *
 * `-copy`, then `-copy-2`… rather than a numeric suffix on the base, because
 * "api-copy-2" reads as the second copy of api while "api-2" reads as a second
 * api, and one of those is a lie about what the resource is.
 *
 * `taken` must include names claimed EARLIER IN THIS SAME PLAN, or cloning two
 * resources at once hands both the same name and the second insert fails on
 * the unique index.
 */
export function cloneName(base: string, taken: ReadonlySet<string>): string {
  // Cloning a clone shouldn't stutter into "api-copy-copy".
  const root = base.replace(/-copy(-\d+)?$/, "");
  const candidateAt = (i: number) => (i === 0 ? `${root}-copy` : `${root}-copy-${i + 1}`);
  for (let i = 0; i < 100; i++) {
    const candidate = candidateAt(i);
    // The name column is bounded; a truncated candidate could collide with a
    // different truncated candidate, so re-check after slicing.
    const bounded = candidate.slice(0, 60);
    if (!taken.has(bounded)) return bounded;
  }
  // Pathological: 100 copies of one name. Better than looping forever.
  return `${root}-copy-${taken.size + 1}`.slice(0, 60);
}

/**
 * Rewrite the refs in one env value against a rename map.
 *
 * Literal text (including escaped `\${{`) is reproduced exactly: the parser
 * already resolved escaping, so re-emitting a literal that begins with `${{`
 * has to re-escape it or a round-trip would turn an escaped ref into a live
 * one.
 */
export function rewriteRefs(
  value: string,
  rename: ReadonlyMap<string, string>,
): { value: string; external: string[] } {
  const parsed = parseValue(value);
  // Unparseable values are copied verbatim. A clone is not the place to start
  // rejecting values the source resource is happily running with.
  if (!parsed.ok) return { value, external: [] };

  const external: string[] = [];
  let out = "";
  for (const token of parsed.tokens) {
    if (token.kind === "literal") {
      out += token.value.replaceAll("${{", "\\${{");
      continue;
    }
    const target = rename.get(token.resource);
    if (target === undefined) {
      external.push(token.resource);
      out += token.raw;
    } else {
      out += `\${{${target}.${token.var}}}`;
    }
  }
  return { value: out, external };
}

/**
 * Build the plan: names for every copy, plus the references that will still
 * reach outside the set.
 *
 * `existingNames` is the project's current names; the plan reserves each new
 * name as it goes so two sources can't be assigned the same one.
 */
export function planClone(
  sources: readonly CloneSource[],
  existingNames: readonly string[],
  envBySource: ReadonlyMap<string, Readonly<Record<string, string>>>,
): ClonePlan {
  const taken = new Set(existingNames);
  const items: ClonePlanItem[] = [];
  const rename = new Map<string, string>();

  for (const source of sources) {
    const targetName = cloneName(source.name, taken);
    taken.add(targetName);
    items.push({ resourceId: source.resourceId, sourceName: source.name, targetName });
    rename.set(source.name, targetName);
  }

  // Second pass: the rename map has to be complete before any value is
  // rewritten, or a ref to a resource later in the list would be classed as
  // external purely because of ordering.
  const externalRefs: ExternalRef[] = [];
  for (const item of items) {
    const env = envBySource.get(item.resourceId) ?? {};
    for (const [envKey, value] of Object.entries(env)) {
      for (const toName of rewriteRefs(value, rename).external) {
        externalRefs.push({ fromName: item.targetName, toName, envKey });
      }
    }
  }

  return { items, rename, externalRefs };
}
