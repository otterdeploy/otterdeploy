import { consola } from "consola";

export interface Change {
  kind: string;
  resource: string;
  name: string;
  details?: unknown;
}

export function printDiff(changes: Change[]): void {
  if (changes.length === 0) {
    consola.info("In sync — no changes.");
    return;
  }
  for (const c of changes) {
    const symbol =
      c.kind === "create" ? "+" : c.kind === "delete" ? "-" : c.kind === "update" ? "~" : "·";
    consola.log(`  ${symbol} ${c.resource.padEnd(8)} ${c.name}`);
    if (c.details) {
      const summary = JSON.stringify(c.details);
      if (summary.length < 200) consola.log(`      ${summary}`);
    }
  }
}

export function countByKind(changes: Change[]) {
  return changes.reduce(
    (acc, c) => {
      acc[c.kind] = (acc[c.kind] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
}
