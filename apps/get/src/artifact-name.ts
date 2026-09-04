export const ARTIFACT_NAMES = ["install.sh", "uninstall.sh", "docker-compose.yml"] as const;

export type ArtifactName = (typeof ARTIFACT_NAMES)[number];

const artifactNames = new Set<string>(ARTIFACT_NAMES);

/** Keep the public artifact surface to the three authored files. A Set avoids
 * treating Object.prototype names such as `constructor` as configured keys. */
export function isArtifactName(file: string): file is ArtifactName {
  return artifactNames.has(file);
}
