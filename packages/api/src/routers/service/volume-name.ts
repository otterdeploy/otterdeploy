/**
 * Deterministic docker volume names for a service's persistent mounts.
 *
 * A service volume is identified by (serviceName, mountPath). Docker
 * auto-creates a named volume on first task schedule, so we only need a stable,
 * collision-free name: stable so a redeploy re-attaches the SAME data, and
 * collision-free so two mount paths on one service never share a volume. The
 * short content hash guarantees the latter even when two paths slugify alike
 * (e.g. "/a/b" and "/a-b").
 */

import { createHash } from "node:crypto";

/**
 * Canonicalize a container mount path: ensure a leading slash, collapse
 * duplicate slashes, and drop any trailing slash — so "/data", "/data/", and
 * "//data" all address the one mount.
 */
export function normalizeMountPath(raw: string): string {
  const collapsed = `/${raw.trim()}`.replace(/\/+/g, "/").replace(/\/+$/, "");
  return collapsed === "" ? "/" : collapsed;
}

/** Lowercase + reduce to the docker-name-safe alphabet, trimming stray dashes. */
function dockerSafe(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Build the docker volume name for a service mount. Format:
 *   otterdeploy-vol-<serviceName>-<pathSlug>-<hash8>
 * The name is derived purely from (serviceName, normalized mountPath), so it is
 * identical across deploys and unique per mount.
 */
export function buildServiceVolumeName(input: { serviceName: string; mountPath: string }): string {
  const normalized = normalizeMountPath(input.mountPath);
  const pathSlug =
    normalized
      .replace(/^\/+/, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "root";
  const hash = createHash("sha256")
    .update(`${input.serviceName}:${normalized}`)
    .digest("hex")
    .slice(0, 8);
  // Keep the readable prefix bounded so the whole name stays well under
  // docker's limit while always preserving the disambiguating hash.
  const prefix = `otterdeploy-vol-${dockerSafe(input.serviceName)}-${pathSlug}`.slice(0, 100);
  return `${prefix}-${hash}`.replace(/-+/g, "-");
}
