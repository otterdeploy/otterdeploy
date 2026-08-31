/**
 * Where a variable's value comes from.
 *
 * The honest version of provenance, and deliberately not more. `od-1w02` means
 * the project bag is NOT layered into a service's env — it is reachable only
 * through an explicit `${{project.KEY}}` token — and no stack bag exists at
 * all. So a chip claiming "inherited from project" would be false: nothing is
 * inherited. What IS true, and useful, is what a value READS.
 *
 * A row that reads nothing is the service's own. A row that reads `project` or
 * `environment` draws on the shared bag. A row that reads another resource
 * names it, which is the question people actually open this to answer — "where
 * is this database URL pointing".
 *
 * Pure and string-only: the editor holds draft rows, not resolved ones, so
 * this has to work on the value as typed.
 */

/** `${{ scope.KEY }}` / `${{ stack.svc.KEY }}` / `${{ vault.p.ref }}`. The
 *  first segment is the scope; the rest is the address inside it. */
const REF = /\$\{\{\s*([A-Za-z0-9_-]+)\s*\.\s*([^}]*?)\s*\}\}/g;

export type Provenance =
  | { kind: "own" }
  | { kind: "project" }
  | { kind: "environment" }
  | { kind: "vault" }
  | { kind: "resource"; name: string };

/** The scopes that are bags rather than resources. */
const BAG_SCOPES = new Set(["project", "environment", "vault"]);

/**
 * Every distinct source one value reads, in first-seen order.
 *
 * A value can read several (`postgres://${{db.HOST}}/${{project.DB_NAME}}`),
 * so this returns a list rather than picking a winner — picking one would hide
 * the other, and the hidden one is as likely to be the surprise.
 */
export function provenanceOf(value: string): Provenance[] {
  if (!value.includes("${{")) return [{ kind: "own" }];
  const out: Provenance[] = [];
  const seen = new Set<string>();
  for (const match of value.matchAll(REF)) {
    const scope = match[1];
    if (!scope) continue;
    const key = scope.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (key === "project") out.push({ kind: "project" });
    else if (key === "environment") out.push({ kind: "environment" });
    else if (key === "vault") out.push({ kind: "vault" });
    else if (key === "stack") {
      // `${{stack.<svc>.KEY}}` addresses a SIBLING, and the sibling's name is
      // the second segment, not "stack".
      const sibling = (match[2] ?? "").split(".")[0]?.trim();
      if (sibling) out.push({ kind: "resource", name: sibling });
    } else if (!BAG_SCOPES.has(key)) out.push({ kind: "resource", name: scope });
  }
  // A malformed `${{` fragment matches nothing; the value is still the
  // service's own until it parses.
  return out.length > 0 ? out : [{ kind: "own" }];
}

/** The chip label for one source. `own` gets none: "set here" on every
 *  unremarkable row is noise, and most rows are unremarkable. */
export function provenanceLabel(p: Provenance): string | null {
  switch (p.kind) {
    case "own":
      return null;
    case "project":
      return "project";
    case "environment":
      return "environment";
    case "vault":
      return "vault";
    case "resource":
      return p.name;
  }
}
