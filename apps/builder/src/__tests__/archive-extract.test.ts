/**
 * Hostile-archive corpus for `extractArchiveSafely` (od-5j8.16). Every
 * malicious tarball is built programmatically with `tar-stream`'s `pack()`
 * (no binary fixtures) so the exact bytes an attacker would need to craft
 * (a `..` path segment, a symlink pointing outside the root, a device node,
 * a highly-compressible multi-megabyte entry, …) are visible right here.
 */
import type { Headers as TarHeaders } from "tar-stream";

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import tarStreamModule from "tar-stream";

import { DEFAULT_ARCHIVE_LIMITS, extractArchiveSafely, resolveEntryPath } from "../archive-extract";

const { pack: createPack } = tarStreamModule;

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

/** Build a `.tar.gz` in memory from raw headers. Bypasses any path/type
 *  sanitization a higher-level tool might apply, mirroring exactly what an
 *  attacker controls when they hand-craft a hostile tarball. */
async function buildTarGz(entries: Array<{ header: TarHeaders; content?: string | Buffer }>) {
  const pack = createPack();
  for (const e of entries) {
    pack.entry(e.header, e.content ?? "");
  }
  pack.finalize();
  const chunks: Buffer[] = [];
  for await (const chunk of pack) chunks.push(chunk);
  return gzipSync(Buffer.concat(chunks));
}

async function writeArchive(entries: Array<{ header: TarHeaders; content?: string | Buffer }>) {
  const dir = tmpDir("otter-archive-src-");
  const archivePath = join(dir, "source.tar.gz");
  await Bun.write(archivePath, await buildTarGz(entries));
  return archivePath;
}

function freshDest(): string {
  // Don't pre-create it. extractArchiveSafely creates it, and a stray
  // sibling lets traversal tests assert nothing landed outside root.
  return join(tmpDir("otter-archive-parent-"), "workdir");
}

/**
 * bun:test types `.rejects`' matchers as `void` even though they return a
 * promise at runtime, so awaiting `expect(p).rejects.toThrow(...)` trips
 * `await-thenable`. Await the rejection here and hand `toThrow` a synchronous
 * re-thrower instead: identical matcher semantics (substring / RegExp / class),
 * and a promise that unexpectedly resolves yields a non-throwing function so
 * `toThrow(...)` fails with its normal "didn't throw" message.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<() => void> {
  try {
    await promise;
  } catch (err) {
    return () => {
      throw err;
    };
  }
  return () => undefined;
}

describe("extractArchiveSafely: hostile archives are rejected", () => {
  test("rejects a relative path-traversal entry (Zip Slip)", async () => {
    const archivePath = await writeArchive([
      { header: { name: "../../etc/passwd", type: "file" }, content: "pwned" },
    ]);
    const dest = freshDest();

    expect(await rejectionOf(extractArchiveSafely({ archivePath, destDir: dest }))).toThrow(
      /traversal/i,
    );
    expect(existsSync(join(dest, "..", "..", "etc", "passwd"))).toBe(false);
  });

  test("rejects traversal buried inside an otherwise-normal path", async () => {
    const archivePath = await writeArchive([
      { header: { name: "src/../../outside.txt", type: "file" }, content: "pwned" },
    ]);
    const dest = freshDest();

    expect(await rejectionOf(extractArchiveSafely({ archivePath, destDir: dest }))).toThrow(
      /traversal/i,
    );
  });

  test("rejects an absolute path entry", async () => {
    const archivePath = await writeArchive([
      { header: { name: "/etc/passwd", type: "file" }, content: "pwned" },
    ]);
    const dest = freshDest();

    expect(await rejectionOf(extractArchiveSafely({ archivePath, destDir: dest }))).toThrow(
      /absolute path/i,
    );
    expect(existsSync("/tmp/passwd")).toBe(false);
  });

  test("rejects a Windows-style absolute path entry", async () => {
    const archivePath = await writeArchive([
      { header: { name: "C:\\Windows\\system.ini", type: "file" }, content: "pwned" },
    ]);
    const dest = freshDest();

    expect(await rejectionOf(extractArchiveSafely({ archivePath, destDir: dest }))).toThrow(
      /absolute path/i,
    );
  });

  test("rejects a symlink entry pointing outside the extraction root", async () => {
    const archivePath = await writeArchive([
      { header: { name: "evil-link", type: "symlink", linkname: "../../../../etc" } },
    ]);
    const dest = freshDest();

    expect(await rejectionOf(extractArchiveSafely({ archivePath, destDir: dest }))).toThrow(
      /symlink/i,
    );
    expect(existsSync(join(dest, "evil-link"))).toBe(false);
  });

  test("rejects a symlink-then-write escape sequence entirely", async () => {
    // Classic two-step Zip Slip variant: plant a symlink named "link" that
    // points at the parent directory, then a second entry "link/pwned.txt"
    // that would write *through* the symlink onto the host if it were ever
    // created. Since symlinks are rejected outright, the archive is thrown
    // out on the first entry: the second entry is never even considered.
    const archivePath = await writeArchive([
      { header: { name: "link", type: "symlink", linkname: ".." } },
      { header: { name: "link/pwned.txt", type: "file" }, content: "pwned" },
    ]);
    const dest = freshDest();

    expect(await rejectionOf(extractArchiveSafely({ archivePath, destDir: dest }))).toThrow(
      /symlink/i,
    );
    expect(existsSync(join(dest, "..", "pwned.txt"))).toBe(false);
  });

  test("rejects a hard-link entry", async () => {
    const archivePath = await writeArchive([
      { header: { name: "hard-link", type: "link", linkname: "somewhere-else" } },
    ]);
    const dest = freshDest();

    expect(await rejectionOf(extractArchiveSafely({ archivePath, destDir: dest }))).toThrow(
      /hard link/i,
    );
  });

  test("rejects a character-device entry", async () => {
    const archivePath = await writeArchive([
      { header: { name: "dev-null", type: "character-device", devmajor: 1, devminor: 3 } },
    ]);
    const dest = freshDest();

    expect(await rejectionOf(extractArchiveSafely({ archivePath, destDir: dest }))).toThrow(
      /device|special/i,
    );
  });

  test("rejects a block-device entry", async () => {
    const archivePath = await writeArchive([
      { header: { name: "dev-sda", type: "block-device", devmajor: 8, devminor: 0 } },
    ]);
    const dest = freshDest();

    expect(await rejectionOf(extractArchiveSafely({ archivePath, destDir: dest }))).toThrow(
      /device|special/i,
    );
  });

  test("rejects a FIFO entry", async () => {
    const archivePath = await writeArchive([{ header: { name: "pipe", type: "fifo" } }]);
    const dest = freshDest();

    expect(await rejectionOf(extractArchiveSafely({ archivePath, destDir: dest }))).toThrow(
      /device|special/i,
    );
  });

  test("rejects an entry count above the configured cap", async () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({
      header: { name: `file-${i}.txt`, type: "file" as const },
      content: "x",
    }));
    const archivePath = await writeArchive(entries);
    const dest = freshDest();

    expect(
      await rejectionOf(
        extractArchiveSafely({ archivePath, destDir: dest, limits: { maxEntries: 3 } }),
      ),
    ).toThrow(/more than 3 entries/);
  });

  test("rejects a single entry over the per-file byte cap", async () => {
    const content = Buffer.alloc(200 * 1024, 1); // 200KB
    const archivePath = await writeArchive([
      { header: { name: "big.bin", type: "file" }, content },
    ]);
    const dest = freshDest();

    expect(
      await rejectionOf(
        extractArchiveSafely({
          archivePath,
          destDir: dest,
          limits: { maxEntryBytes: 100 * 1024 },
        }),
      ),
    ).toThrow(/per-file/);
  });

  test("rejects an archive whose total decompressed bytes exceed the cap", async () => {
    // Two entries, individually under any per-file cap, but their sum blows
    // the total budget. Random-ish (non-all-zero) content so this is
    // exercising the absolute-size cap, not the ratio trip wire.
    const a = Buffer.alloc(700 * 1024);
    const b = Buffer.alloc(700 * 1024);
    for (let i = 0; i < a.length; i++) a[i] = (i * 7) % 256;
    for (let i = 0; i < b.length; i++) b[i] = (i * 13) % 256;
    const archivePath = await writeArchive([
      { header: { name: "a.bin", type: "file" }, content: a },
      { header: { name: "b.bin", type: "file" }, content: b },
    ]);
    const dest = freshDest();

    expect(
      await rejectionOf(
        extractArchiveSafely({
          archivePath,
          destDir: dest,
          limits: { maxUncompressedBytes: 1024 * 1024, maxEntryBytes: 1024 * 1024 },
        }),
      ),
    ).toThrow(/total uncompressed size/);
  });

  test("rejects a highly-compressible entry as a decompression bomb by ratio", async () => {
    // 4MB of zeros gzips down to well under a kilobyte (a >1000:1 ratio)
    // long before it would ever hit an absolute size cap sized for real
    // source trees.
    const zeros = Buffer.alloc(4 * 1024 * 1024, 0);
    const archivePath = await writeArchive([
      { header: { name: "zeros.bin", type: "file" }, content: zeros },
    ]);
    const dest = freshDest();

    expect(
      await rejectionOf(
        extractArchiveSafely({
          archivePath,
          destDir: dest,
          limits: {
            maxUncompressedBytes: 1024 * 1024 * 1024, // absolute cap deliberately not the trigger
            maxCompressionRatio: 100,
            ratioCheckFloorBytes: 64 * 1024,
          },
        }),
      ),
    ).toThrow(/compression ratio/);
  });

  test("rejects a path longer than the configured cap", async () => {
    const longName = `${"a".repeat(200)}.txt`;
    const archivePath = await writeArchive([
      { header: { name: longName, type: "file" }, content: "x" },
    ]);
    const dest = freshDest();

    expect(
      await rejectionOf(
        extractArchiveSafely({ archivePath, destDir: dest, limits: { maxPathLength: 50 } }),
      ),
    ).toThrow(/exceeds 50 characters/);
  });

  test("rejects a path nested deeper than the configured segment cap", async () => {
    const deepName = Array.from({ length: 8 }, (_, i) => `d${i}`).join("/") + "/leaf.txt";
    const archivePath = await writeArchive([
      { header: { name: deepName, type: "file" }, content: "x" },
    ]);
    const dest = freshDest();

    expect(
      await rejectionOf(
        extractArchiveSafely({ archivePath, destDir: dest, limits: { maxPathSegments: 3 } }),
      ),
    ).toThrow(/nested deeper/);
  });

  test("rejects an exact duplicate path", async () => {
    const archivePath = await writeArchive([
      { header: { name: "same.txt", type: "file" }, content: "first" },
      { header: { name: "same.txt", type: "file" }, content: "second" },
    ]);
    const dest = freshDest();

    expect(await rejectionOf(extractArchiveSafely({ archivePath, destDir: dest }))).toThrow(
      /duplicate entry/,
    );
  });

  test("rejects entries that collide only by case (macOS default volume is case-insensitive)", async () => {
    const archivePath = await writeArchive([
      { header: { name: "Config.json", type: "file" }, content: '{"safe":true}' },
      { header: { name: "config.json", type: "file" }, content: '{"malicious":true}' },
    ]);
    const dest = freshDest();

    expect(await rejectionOf(extractArchiveSafely({ archivePath, destDir: dest }))).toThrow(
      /colliding entries/,
    );
  });

  test("rejects entries that collide only by Unicode normalization form", async () => {
    // "café.txt" as precomposed NFC (é = U+00E9) vs decomposed NFD (e +
    // U+0301 combining acute): visually identical, different bytes, same
    // file once normalized (as macOS's filesystem effectively does).
    const nfc = "cafeé.txt";
    const decomposed = "cafeé.txt";
    const archivePath = await writeArchive([
      { header: { name: nfc, type: "file" }, content: "one" },
      { header: { name: decomposed, type: "file" }, content: "two" },
    ]);
    const dest = freshDest();

    expect(await rejectionOf(extractArchiveSafely({ archivePath, destDir: dest }))).toThrow(
      /colliding entries/,
    );
  });

  // tar's name field is a fixed-width NUL-terminated C string, so `pack()`
  // silently truncates "ok\0evil" to "ok": a NUL cannot round-trip through a
  // well-formed archive. The guard still matters for hand-crafted tars and PAX
  // extended headers, so assert it against the validator directly rather than
  // through an archive that can't carry the input.
  test("rejects a NUL byte in an entry name", () => {
    expect(() =>
      resolveEntryPath("ok\0evil", freshDest(), DEFAULT_ARCHIVE_LIMITS, new Map()),
    ).toThrow(/NUL byte/);
  });
});

describe("extractArchiveSafely: legitimate archives still extract", () => {
  test("extracts a normal project tree with nested directories and files", async () => {
    const archivePath = await writeArchive([
      { header: { name: "src/", type: "directory" } },
      { header: { name: "src/index.ts", type: "file" }, content: "export const x = 1;\n" },
      { header: { name: "src/lib/", type: "directory" } },
      { header: { name: "src/lib/util.ts", type: "file" }, content: "export function f() {}\n" },
      { header: { name: "package.json", type: "file" }, content: '{"name":"demo"}\n' },
      { header: { name: "README.md", type: "file" }, content: "# demo\n" },
    ]);
    const dest = freshDest();

    await extractArchiveSafely({ archivePath, destDir: dest });

    expect(readFileSync(join(dest, "src/index.ts"), "utf8")).toBe("export const x = 1;\n");
    expect(readFileSync(join(dest, "src/lib/util.ts"), "utf8")).toBe("export function f() {}\n");
    expect(readFileSync(join(dest, "package.json"), "utf8")).toBe('{"name":"demo"}\n');
    expect(readFileSync(join(dest, "README.md"), "utf8")).toBe("# demo\n");
  });

  test("extracts files without a preceding explicit directory entry", async () => {
    // Common with `tar -C dir .`-style archives: no explicit "a/" entry,
    // just "a/b/c.txt" straight away. Parent dirs must be created on demand.
    const archivePath = await writeArchive([
      { header: { name: "a/b/c.txt", type: "file" }, content: "nested\n" },
    ]);
    const dest = freshDest();

    await extractArchiveSafely({ archivePath, destDir: dest });

    expect(readFileSync(join(dest, "a/b/c.txt"), "utf8")).toBe("nested\n");
  });

  test("extracts a single non-colliding Unicode filename correctly", async () => {
    const archivePath = await writeArchive([
      { header: { name: "café.txt", type: "file" }, content: "unicode ok\n" },
    ]);
    const dest = freshDest();

    await extractArchiveSafely({ archivePath, destDir: dest });

    expect(readFileSync(join(dest, "café.txt"), "utf8")).toBe("unicode ok\n");
  });

  test("accepts a moderately deep, real-world path", async () => {
    const archivePath = await writeArchive([
      {
        header: { name: "src/features/widgets/components/detail/view.tsx", type: "file" },
        content: "export default function View() { return null; }\n",
      },
    ]);
    const dest = freshDest();

    await extractArchiveSafely({ archivePath, destDir: dest });

    expect(existsSync(join(dest, "src/features/widgets/components/detail/view.tsx"))).toBe(true);
  });
});
