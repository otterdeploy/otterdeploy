/**
 * otterd release files: `/otterd/v<version>/<file>`.
 *
 * A node install and `node.upgrade` fetch the node binaries from here
 * (`<release URL>/v<version>/otterd-linux-<arch>`, release URL
 * `https://get.otterdeploy.com/otterd`), next to the signed release manifest
 * that names each binary's size and SHA-256. The node verifies the manifest
 * against its pinned release keys and the binary against the manifest, so
 * this edge only has to serve the exact bytes.
 *
 * Only release-pinned paths exist (no `latest`): a version's files never
 * change, and a fallback to the repo is meaningless for build output, so a
 * file R2 does not have is a 404.
 */

/** Release tags only, as for the platform artifacts. */
const VERSION_RE = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;

const BINARIES = ["otterd", "otterd-guard", "otterd-net", "otterd-dns", "otterd-recover"] as const;
const ARCHES = ["x86_64", "aarch64"] as const;

const FILES = new Set<string>([
  "release.json",
  ...BINARIES.flatMap((b) => ARCHES.map((a) => `${b}-linux-${a}`)),
]);

export interface OtterdArtifact {
  /** R2 object key. */
  key: string;
  version: string;
  file: string;
  contentType: string;
}

/** The release file a path names, or null for anything else. */
export function otterdArtifact(pathname: string): OtterdArtifact | null {
  const segments = pathname.replace(/^\/+/, "").split("/");
  if (segments.length !== 3 || segments[0] !== "otterd") return null;
  const [, version = "", file = ""] = segments;
  if (!VERSION_RE.test(version) || !FILES.has(file)) return null;
  return {
    key: `otterd/${version}/${file}`,
    version,
    file,
    contentType:
      file === "release.json" ? "application/json; charset=utf-8" : "application/octet-stream",
  };
}
