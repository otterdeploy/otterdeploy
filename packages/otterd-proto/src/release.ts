/**
 * Signed releases and the release keys that sign them; mirror of `release.rs`.
 */
import * as z from "zod";

import { publicKey, sha256Hex, u16, u53 } from "./primitives";
import { versionRange } from "./version";

export const releaseArtifact = z.strictObject({
  arch: z.string(),
  sha256: sha256Hex,
  size: u53,
});

/** `otterd/release-manifest/v1`. */
export const releaseManifest = z.strictObject({
  version: z.string(),
  artifacts: z.array(releaseArtifact),
  protocol: versionRange,
  journalFormat: u16,
  minRollbackVersion: z.string(),
  issuedAtUnixMs: u53,
});
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
