/**
 * Error mapping shared by the manifest handlers.
 *
 * Kept out of router-manifest.ts so the router stays a list of endpoints, and
 * so the mapping has one home: three handlers resolve a manifest and all three
 * must answer a failure identically. Duplicating the map is how one of them
 * ends up still surfacing a 500.
 */
import type { ManifestMergeError } from "../../stack/manifest";

/**
 * How `resolvedManifest` fails. A missing project is 404. An environment block
 * that does not merge into a valid manifest is the operator's document being
 * wrong, so 400 — it used to escape as an uncaught throw, i.e. a 500, for a
 * typo they could have fixed.
 */
export function resolvedManifestErrors(errors: {
  NOT_FOUND: () => Error;
  INVALID_MANIFEST: (init: { message: string }) => Error;
}) {
  return {
    ProjectNotFoundError: () => errors.NOT_FOUND(),
    ManifestMergeError: (error: ManifestMergeError) =>
      errors.INVALID_MANIFEST({ message: error.message }),
  };
}
