import type { Change, Manifest } from "../../stack/manifest";

import { parseCompose, summarizeCompose } from "../../stack/compose";

/**
 * Attach a parsed service summary to each compose `create` change so the graph
 * can render the staged stack as a ghost group node WITH its service cards,
 * not an empty "No services parsed yet" box. Parsing lives here (the handler),
 * not in the pure `diffManifest`, so the diff stays YAML-free and testable.
 * Git stacks have no inline file to parse; their cards appear after the build.
 */
export function enrichComposeCreates(changes: Change[], manifest: Manifest): Change[] {
  return changes.map((c) => {
    if (c.resource !== "compose" || c.kind !== "create") return c;
    const spec = manifest.composes[c.name];
    if (!spec || spec.source !== "inline") return c;
    const parsed = parseCompose(spec.content);
    if (parsed.isErr()) return c;
    return {
      ...c,
      details: {
        ...c.details,
        services: summarizeCompose(parsed.value),
        // Carry the template brand so the pending ghost group renders the
        // stack's logo immediately, before the first deploy persists it.
        ...(spec.logoBrand ? { logoBrand: spec.logoBrand } : {}),
      },
    };
  });
}
