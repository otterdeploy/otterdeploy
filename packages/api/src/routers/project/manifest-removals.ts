import type { Manifest } from "../../stack/manifest";

/**
 * What a save would REMOVE, relative to the manifest already stored.
 *
 * `manifest.save` replaces the whole document, so a payload that merely omits
 * a resource deletes it. That is a defensible design for a declarative
 * document, but it means the difference between "update one field" and "wipe
 * the project" is invisible at the call site: the correct read-modify-write
 * pattern has to be inferred, and only the `expectedVersion` check stands
 * between a malformed payload and a project with no services (od-mizn).
 *
 * PURE, so the dangerous part is the part that is testable.
 */
interface ManifestRemoval {
  resource: "service" | "database" | "compose";
  name: string;
}

export function manifestRemovals(current: Manifest | null, next: Manifest): ManifestRemoval[] {
  if (!current) return [];
  const sections = [
    ["service", current.services, next.services],
    ["database", current.databases, next.databases],
    ["compose", current.composes, next.composes],
  ] as const;

  const removals: ManifestRemoval[] = [];
  for (const [resource, before, after] of sections) {
    for (const name of Object.keys(before ?? {})) {
      if (!(name in (after ?? {}))) removals.push({ resource, name });
    }
  }
  // Stable order: a diff the operator reads twice should not reshuffle.
  return removals.sort(
    (a, b) => a.resource.localeCompare(b.resource) || a.name.localeCompare(b.name),
  );
}
