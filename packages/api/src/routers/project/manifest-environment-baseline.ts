/**
 * An environment's pending changes, measured against what THAT environment
 * applied.
 *
 * One manifest document serves every environment: a shared base plus an
 * `environments.<slug>` block each. The applied snapshot used to be one per
 * project as well, holding the document resolved for whichever environment
 * applied last, and two readers took it as a description of the environment
 * on screen:
 *
 *   - The diff took it as proof the manifest had owned a resource, so a
 *     resource another environment applied read here as a pending DELETE: a
 *     running resource nobody removed, one Apply from being torn down.
 *   - Discard copied it into the saved manifest. That baked one
 *     environment's overrides into everyone's base, so the change the
 *     operator discarded in another environment came straight back, and the
 *     bar went on reporting it after "Pending changes discarded".
 *
 * Each environment now records its own apply (the `environment` table's
 * `applied_manifest` columns). Everything here is PURE so the rules that
 * decide what may be deleted and what a discard writes are tested directly.
 */
import type { EnvironmentOverride, Manifest } from "../../stack/manifest";

import { revertEntries, type SkippedResource } from "./manifest-applied-snapshot";

/** What one environment last applied. */
export interface EnvironmentApplied {
  /** The whole document as it stood: base and every environment block. */
  document: Manifest | null;
  /** That document resolved for the environment: exactly what it ran. */
  resolved: Manifest | null;
}

type Section = "services" | "databases" | "composes";
type OverlaySection = "services" | "databases";

/** Which manifest sections a resource kind lives in. An `env` entry names its
 *  owner, which may be a service or a database. */
function sectionsOf(resource: SkippedResource["resource"]): Section[] {
  if (resource === "service") return ["services"];
  if (resource === "database") return ["databases"];
  if (resource === "compose") return ["composes"];
  return ["services", "databases"];
}

function overlayOf(section: Section): OverlaySection | null {
  return section === "composes" ? null : section;
}

/** `map` with `name` set to `value`, or removed when `value` is undefined. */
function put<V>(map: Record<string, V> | undefined, name: string, value: V | undefined) {
  const copy: Record<string, V> = { ...map };
  if (value === undefined) delete copy[name];
  else copy[name] = value;
  return copy;
}

/** An environment block with one resource set as `from`'s block had it (or
 *  pinned absent with `null`). Empty maps are dropped, so a block that pins
 *  nothing reads as the plain mirror `{}`. */
function withOverlayEntry(
  block: EnvironmentOverride,
  section: OverlaySection,
  name: string,
  from: EnvironmentOverride | null | undefined,
): EnvironmentOverride {
  const { services, databases } = block;
  const next =
    section === "services"
      ? { services: put(services, name, from === null ? null : from?.services?.[name]), databases }
      : {
          services,
          databases: put(databases, name, from === null ? null : from?.databases?.[name]),
        };
  return {
    ...(next.services && Object.keys(next.services).length > 0 && { services: next.services }),
    ...(next.databases && Object.keys(next.databases).length > 0 && { databases: next.databases }),
  };
}

/** `manifest` with one environment block's entry for `name` replaced. */
function setOverlay(
  manifest: Manifest,
  environment: string,
  section: OverlaySection,
  name: string,
  from: EnvironmentOverride | null | undefined,
): Manifest {
  const block = manifest.environments?.[environment];
  if (!block && from === undefined) return manifest;
  return {
    ...manifest,
    environments: {
      ...manifest.environments,
      [environment]: withOverlayEntry(block ?? {}, section, name, from),
    },
  };
}

/** `manifest` with one base entry put back as `from` had it. */
function setBase(manifest: Manifest, section: Section, name: string, from: Manifest | null) {
  if (section === "services") {
    return { ...manifest, services: put(manifest.services, name, from?.services?.[name]) };
  }
  if (section === "databases") {
    return { ...manifest, databases: put(manifest.databases, name, from?.databases?.[name]) };
  }
  return { ...manifest, composes: put(manifest.composes, name, from?.composes?.[name]) };
}

/**
 * The document to record for an environment after an apply: what was
 * submitted, with each resource the apply did not land put back as this
 * environment's previous apply had it (its base entry and its own block's).
 * Same rule as `snapshotAfterApply`, on the unresolved document.
 */
export function documentAfterApply(args: {
  submitted: Manifest;
  previous: Manifest | null;
  skipped: readonly SkippedResource[];
  environment: string | undefined;
}): Manifest {
  let next = revertEntries({
    target: args.submitted,
    source: args.previous,
    resources: args.skipped,
  });
  const environment = args.environment;
  if (!environment) return next;
  for (const entry of args.skipped) {
    for (const section of sectionsOf(entry.resource)) {
      const overlay = overlayOf(section);
      if (!overlay) continue;
      next = setOverlay(
        next,
        environment,
        overlay,
        entry.name,
        args.previous?.environments?.[environment],
      );
    }
  }
  return next;
}

/**
 * Deletes in a plan that nothing explains. A delete is traced when the
 * environment's own last apply declared the resource and the manifest, as
 * resolved for that environment, no longer does: the operator took it out of
 * the base, or set it to `null` in this environment's block. A same-name
 * replace (a changed `source` or `engine`) is traced by the resource still
 * being declared. `env` deletes are variables, not resources.
 */
export function untracedDeletes(
  planned: ReadonlyArray<{ kind: string; resource: string; name: string }>,
  evidence: { desired: Manifest; applied: Manifest | null },
): Array<{ resource: "service" | "database"; name: string }> {
  const out: Array<{ resource: "service" | "database"; name: string }> = [];
  for (const change of planned) {
    if (change.kind !== "delete") continue;
    if (change.resource !== "service" && change.resource !== "database") continue;
    const section = change.resource === "service" ? "services" : "databases";
    const stillDeclared = evidence.desired[section][change.name] !== undefined;
    const appliedHere = evidence.applied?.[section]?.[change.name] !== undefined;
    if (stillDeclared || appliedHere) continue;
    out.push({ resource: change.resource, name: change.name });
  }
  return out;
}

/** Whether `baseline`, resolved for `environment`, has no such resource. */
function absentIn(
  baseline: Manifest | null,
  environment: string,
  section: OverlaySection,
  name: string,
): boolean {
  const pinned = baseline?.environments?.[environment]?.[section]?.[name];
  if (pinned === null) return true;
  return pinned === undefined && baseline?.[section]?.[name] === undefined;
}

/** Whether taking `name` out of the shared base would reach past this
 *  environment: another environment runs it, or extends it in its block. */
function sharedElsewhere(
  manifest: Manifest,
  environment: string,
  section: OverlaySection,
  name: string,
  appliedElsewhere: readonly Manifest[],
): boolean {
  const extended = Object.entries(manifest.environments ?? {}).some(
    ([slug, block]) => slug !== environment && Boolean(block[section]?.[name]),
  );
  return extended || appliedElsewhere.some((m) => m[section][name] !== undefined);
}

/**
 * The manifest a discard in one environment leaves behind.
 *
 * Each named resource goes back to how the environment's last apply had it:
 * its base entry and its entry in this environment's block. One exception
 * keeps the discard inside the environment: when going back means taking a
 * resource out of the shared base while another environment runs it (or
 * extends it in its own block), the base keeps it and this environment's
 * block says `null` instead. Otherwise discarding an unwanted create here
 * would stage the deletion of the same resource where it is live.
 */
export function manifestAfterEnvironmentDiscard(args: {
  manifest: Manifest | null;
  /** The document this environment last applied (or the project's legacy
   *  snapshot, for an environment that has not applied since). */
  baseline: Manifest | null;
  environment: string | undefined;
  resources: readonly SkippedResource[];
  /** What every OTHER environment last applied, resolved for itself. */
  appliedElsewhere: readonly Manifest[];
}): Manifest | null {
  const { baseline, environment } = args;
  // Nothing readable is staged: there is nothing to scope, so go back to the
  // baseline whole, as a discard always has.
  if (!args.manifest) return baseline;
  let next = args.manifest;
  for (const entry of args.resources) {
    for (const section of sectionsOf(entry.resource)) {
      const overlay = overlayOf(section);
      const name = entry.name;
      if (
        environment &&
        overlay &&
        next[overlay][name] !== undefined &&
        absentIn(baseline, environment, overlay, name) &&
        sharedElsewhere(next, environment, overlay, name, args.appliedElsewhere)
      ) {
        next = setOverlay(next, environment, overlay, name, null);
        continue;
      }
      next = setBase(next, section, name, baseline);
      if (environment && overlay) {
        next = setOverlay(next, environment, overlay, name, baseline?.environments?.[environment]);
      }
    }
  }
  return next;
}
