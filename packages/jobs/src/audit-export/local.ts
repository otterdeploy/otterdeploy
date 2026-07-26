/**
 * Local-directory export destination — for the "this directory is actually
 * an off-host mount" case (NFS, an attached network volume). See
 * ./destination.ts for why this isn't wired into the backups feature's
 * destination table.
 */
import type { AuditExportDestination } from "./destination";

import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

function keyToPath(rootDir: string, key: string): string {
  // Keys are always forward-slash paths (`audit/2026/07/26/...`); join
  // normalizes for the host OS.
  return join(rootDir, ...key.split("/"));
}

async function walk(dir: string, base: string, out: string[]): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, base, out);
    } else if (entry.isFile()) {
      out.push(relative(base, full).split(/\\|\//).join("/"));
    }
  }
}

export function createLocalExportDestination(rootDir: string): AuditExportDestination {
  return {
    kind: "local",
    async putObject(key, body) {
      const path = keyToPath(rootDir, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body, "utf8");
    },
    async listKeys(prefix) {
      const out: string[] = [];
      await walk(rootDir, rootDir, out);
      return out.filter((k) => k.startsWith(prefix)).sort();
    },
    async deleteObject(key) {
      const path = keyToPath(rootDir, key);
      await rm(path, { force: true });
    },
  };
}

/** True if the directory exists and is writable-looking (best-effort). */
export async function localDirLooksUsable(rootDir: string): Promise<boolean> {
  try {
    const s = await stat(rootDir);
    return s.isDirectory();
  } catch {
    return false;
  }
}
