/**
 * Pure half of the volume file explorer: the path gate that keeps user input
 * inside the /v mount, and the parser for the BusyBox `stat` lines the helper
 * container prints. No daemon, no I/O — unit-tested in
 * __tests__/explore.test.ts; the container plumbing lives in explore.ts.
 */
import { posix } from "node:path";

/** Where `volumeMountSpec` mounts the volume inside the helper container. */
export const VOLUME_MOUNT_TARGET = "/v";

/** BusyBox `stat` format: path, type text, bytes, mtime epoch, octal mode.
 *  Tab-delimited; only `%n` can itself contain tabs, so lines are parsed
 *  right-to-left (see `parseStatLine`). */
export const STAT_LIST_FORMAT = "%n\t%F\t%s\t%Y\t%a";

export type ResolvedVolumePath =
  | { ok: true; containerPath: string; relative: string }
  | { ok: false; reason: string };

/**
 * Normalize a user-supplied path inside the volume and refuse anything that
 * could escape the mount: `..` segments (even ones a normalize would collapse
 * away — reject, don't repair), `~` expansion candidates, NUL bytes. The
 * container path is only ever built by joining vetted segments onto /v, and a
 * final resolve() re-checks containment as defense in depth (the same
 * belt-and-braces as swarm/file-mounts.ts `resolveFileMountPath`).
 */
export function resolveVolumeExplorePath(path: string): ResolvedVolumePath {
  if (path.includes("\0")) {
    return { ok: false, reason: "path contains a NUL byte" };
  }
  // Leading slashes are tolerated as "relative to the volume root"; empty
  // segments and bare `.` are dropped so `./a//b/` and `a/b` are the same key.
  const segments = path.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.some((s) => s === "..")) {
    return { ok: false, reason: "path must not contain '..' segments" };
  }
  if (segments[0]?.startsWith("~")) {
    return { ok: false, reason: "path must not start with '~'" };
  }
  const relative = segments.join("/");
  const containerPath =
    relative === "" ? VOLUME_MOUNT_TARGET : `${VOLUME_MOUNT_TARGET}/${relative}`;
  // Defense in depth: after normalization the path must still sit under /v.
  const resolved = posix.resolve(containerPath);
  if (resolved !== VOLUME_MOUNT_TARGET && !resolved.startsWith(`${VOLUME_MOUNT_TARGET}/`)) {
    return { ok: false, reason: "path escapes the volume mount" };
  }
  return { ok: true, containerPath, relative };
}

export interface VolumeDirEntry {
  name: string;
  kind: "file" | "dir" | "symlink" | "other";
  /** stat %s — meaningful for files; directories report their inode size. */
  size: number;
  /** Unix seconds (stat %Y). */
  mtime: number;
  /** Octal permission string (stat %a), e.g. "755". */
  mode: string;
}

/** BusyBox `stat %F` type text → entry kind ("regular file", "regular empty
 *  file", "directory", "symbolic link", plus device/fifo/socket variants). */
function kindFromStatType(typeText: string): VolumeDirEntry["kind"] {
  if (typeText === "directory") return "dir";
  if (typeText.startsWith("regular")) return "file";
  if (typeText === "symbolic link") return "symlink";
  return "other";
}

export interface ParsedStatLine {
  path: string;
  kind: VolumeDirEntry["kind"];
  size: number;
  mtime: number;
  mode: string;
}

/**
 * Parse one `STAT_LIST_FORMAT` line. Fields are read right-to-left because
 * only the leading `%n` may contain the tab delimiter (a tab in a filename is
 * legal); the trailing four fields are a type word, two numbers, and an octal
 * mode, none of which can. Returns null for unparseable fragments — e.g. the
 * shrapnel a newline-bearing filename produces — which are skipped rather
 * than guessed at.
 */
export function parseStatLine(line: string): ParsedStatLine | null {
  const parts = line.split("\t");
  if (parts.length < 5) return null;
  const mode = parts[parts.length - 1] ?? "";
  const mtime = Number(parts[parts.length - 2]);
  const size = Number(parts[parts.length - 3]);
  const typeText = parts[parts.length - 4] ?? "";
  const path = parts.slice(0, parts.length - 4).join("\t");
  if (!/^[0-7]{1,4}$/.test(mode)) return null;
  if (!Number.isInteger(size) || size < 0) return null;
  if (!Number.isInteger(mtime)) return null;
  if (path === "") return null;
  return { path, kind: kindFromStatType(typeText), size, mtime, mode };
}

export interface VolumeDirListing {
  /** The listed path's own stat entry (depth 0) — proves existence + kind. */
  self: { kind: VolumeDirEntry["kind"] } | null;
  entries: VolumeDirEntry[];
}

/**
 * Split the find/stat stdout for a directory listing into the directory's own
 * entry (depth 0 — its presence proves the path exists, its kind proves it's
 * a directory) and its direct children, sorted directories-first then by name.
 */
export function parseVolumeDirListing(stdout: string, containerPath: string): VolumeDirListing {
  const childPrefix = `${containerPath}/`;
  let self: { kind: VolumeDirEntry["kind"] } | null = null;
  const entries: VolumeDirEntry[] = [];
  for (const line of stdout.split("\n")) {
    if (line === "") continue;
    const parsed = parseStatLine(line);
    if (!parsed) continue;
    if (parsed.path === containerPath) {
      self = { kind: parsed.kind };
      continue;
    }
    if (!parsed.path.startsWith(childPrefix)) continue;
    const name = parsed.path.slice(childPrefix.length);
    // -maxdepth 1 already guarantees direct children; a `/` here means the
    // line is shrapnel from a newline-bearing filename — drop it.
    if (name === "" || name.includes("/")) continue;
    entries.push({
      name,
      kind: parsed.kind,
      size: parsed.size,
      mtime: parsed.mtime,
      mode: parsed.mode,
    });
  }
  entries.sort(
    (a, b) => Number(b.kind === "dir") - Number(a.kind === "dir") || a.name.localeCompare(b.name),
  );
  return { self, entries };
}
