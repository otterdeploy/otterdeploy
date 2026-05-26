/**
 * File-mount materialization.
 *
 * The `service_mount` table can store mounts of three types: volume, bind,
 * and file. Volume and bind are stateless from our perspective — we just
 * emit the right ServiceSpec entries and swarm/docker handle the rest.
 * `file` is different: the file content lives in our DB, so we have to
 * write it to disk BEFORE the swarm spec lands at the daemon, otherwise
 * the bind-mount points at nothing and the container fails to start.
 *
 * Layout on disk:
 *   <PLATFORM.files.root>/
 *     <serviceName>/
 *       <relativePath>           ← the materialized file
 *       <relativePath.dir>/...   ← parent dirs created as needed
 *
 * Idempotency: writing always replaces. We don't track checksums or "did
 * anything change" — the redeploy that follows would no-op via swarm's
 * own diffing if the spec is byte-identical, but the file itself is
 * always rewritten so the on-disk content matches what the row says.
 *
 * Multi-node note: in a multi-node swarm, every node that could host a
 * task needs read access to the same file path. The simplest deployment
 * is a shared filesystem (NFS, EFS) mounted at `PLATFORM.files.root` on
 * every node; alternatively `Constraints` on the service can pin tasks
 * to a single node.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";

import { PLATFORM } from "../constants";

export interface ServiceMountInput {
  type: "volume" | "bind" | "file";
  target: string;
  source: string | null;
  content: string | null;
  readOnly: boolean;
}

/** Docker swarm Mounts entry. */
export interface SpecMount {
  Type: "volume" | "bind";
  Source: string;
  Target: string;
  ReadOnly: boolean;
}

/**
 * Resolve a service's file-mount `source` (a relative path the user
 * controls) into the absolute on-disk path the container will bind to.
 * Refuses anything that escapes the service's own directory via `..` or
 * an absolute path — a malicious or careless source value can't mount
 * /etc/shadow into a container.
 */
function resolveFileMountPath(serviceName: string, source: string): string {
  const serviceRoot = join(PLATFORM.files.root, serviceName);
  const resolvedAbs = isAbsolute(source)
    ? normalize(source)
    : normalize(join(serviceRoot, source));
  // After normalization, the resolved path must remain under serviceRoot.
  const rel = resolve(resolvedAbs);
  const root = resolve(serviceRoot);
  if (rel !== root && !rel.startsWith(root + sep)) {
    throw new Error(
      `file-mount source "${source}" escapes service directory ${serviceRoot}`,
    );
  }
  return rel;
}

/**
 * Materialize all file-type mounts for a service: write each row's
 * content to its computed path. Volume/bind mounts are passed through
 * unchanged. Returns the SpecMount[] ready to slot into the
 * TaskTemplate.ContainerSpec.Mounts array.
 *
 * Run this BEFORE calling docker.services.create / .update so the
 * filesystem is ready by the time swarm tries to schedule a task.
 */
export async function materializeServiceMounts(
  serviceName: string,
  mounts: ServiceMountInput[],
): Promise<SpecMount[]> {
  const specMounts: SpecMount[] = [];

  for (const mount of mounts) {
    switch (mount.type) {
      case "volume": {
        if (!mount.source) {
          throw new Error(
            `volume mount at ${mount.target} is missing a source (volume name)`,
          );
        }
        specMounts.push({
          Type: "volume",
          Source: mount.source,
          Target: mount.target,
          ReadOnly: mount.readOnly,
        });
        break;
      }
      case "bind": {
        if (!mount.source) {
          throw new Error(
            `bind mount at ${mount.target} is missing a source (host path)`,
          );
        }
        if (!isAbsolute(mount.source)) {
          throw new Error(
            `bind mount source must be an absolute host path: ${mount.source}`,
          );
        }
        specMounts.push({
          Type: "bind",
          Source: mount.source,
          Target: mount.target,
          ReadOnly: mount.readOnly,
        });
        break;
      }
      case "file": {
        if (mount.content == null) {
          throw new Error(
            `file mount at ${mount.target} has no content`,
          );
        }
        // Default the source to the target's basename when not provided —
        // the most common case is "I want config.json mounted at
        // /etc/myapp/config.json" without thinking about an on-disk name.
        const source = mount.source ?? mount.target.split("/").pop() ?? "file";
        const diskPath = resolveFileMountPath(serviceName, source);
        await mkdir(dirname(diskPath), { recursive: true });
        await writeFile(diskPath, mount.content, "utf8");
        specMounts.push({
          Type: "bind",
          Source: diskPath,
          Target: mount.target,
          ReadOnly: mount.readOnly,
        });
        break;
      }
    }
  }

  return specMounts;
}
