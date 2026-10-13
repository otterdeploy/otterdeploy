/**
 * Signed releases and the release keys that sign them; mirror of `release.rs`.
 */
import * as z from "zod";

import { publicKey, sha256Hex, u16, u53 } from "./primitives";
import { versionRange } from "./version";

/** The daemon's own binary, the one `node.upgrade` stages in the A/B slots. */
export const OTTERD = "otterd";

export const releaseArtifact = z.strictObject({
  /** The binary's name; absent means `otterd`. */
  name: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  arch: z.string(),
  sha256: sha256Hex,
  size: u53,
});
export type ReleaseArtifact = z.infer<typeof releaseArtifact>;

export function artifactName(a: ReleaseArtifact): string {
  return a.name ?? OTTERD;
}

/** `otterd/release-manifest/v1`. One manifest signs every binary; a (name, arch) pair appears once. */
export const releaseManifest = z
  .strictObject({
    version: z.string(),
    artifacts: z.array(releaseArtifact),
    protocol: versionRange,
    journalFormat: u16,
    minRollbackVersion: z.string(),
    issuedAtUnixMs: u53,
  })
  .refine(
    (m) =>
      new Set(m.artifacts.map((a) => `${artifactName(a)}/${a.arch}`)).size === m.artifacts.length,
    { message: "an artifact (name, arch) is listed twice" },
  );
export type ReleaseManifest = z.infer<typeof releaseManifest>;

/** `otterd/release-keys/v1`: signed by a key of the current set. */
export const releaseKeySet = z.strictObject({
  serial: u53,
  keys: z.array(
    z.strictObject({
      key: publicKey,
      notBeforeUnixMs: u53.optional(),
      notAfterUnixMs: u53.optional(),
    }),
  ),
});
