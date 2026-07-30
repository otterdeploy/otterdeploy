import { beforeAll, describe, expect, it } from "vite-plus/test";

import { mkdir, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `removeGuardedDir` is the only thing standing between a bad path derivation
 * and an `rm -rf` outside the data root, so it gets tested against a REAL
 * temp tree rather than a mocked fs — a mock would happily "delete" a path the
 * guard should have refused and prove nothing.
 *
 * `DATA_ROOT` is read from the env at module load, so the env var is set before
 * the dynamic import below.
 */
let root: string;
let removeGuardedDir: (path: string, id: string) => Promise<void>;

const exists = async (p: string): Promise<boolean> =>
  stat(p).then(
    () => true,
    () => false,
  );

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "otterdeploy-data-dir-"));
  // oxlint-disable-next-line node/no-process-env -- test env setup boundary: DATA_ROOT is captured at module load, so this must precede the import below.
  process.env.OTTERDEPLOY_DATA_DIR = root;
  ({ removeGuardedDir } = await import("../data-dir"));
});

describe("removeGuardedDir", () => {
  it("removes a directory inside the root whose path ends with the id", async () => {
    const dir = join(root, "resources", "proj_1", "res_abc");
    await mkdir(dir, { recursive: true });
    expect(await exists(dir)).toBe(true);

    await removeGuardedDir(dir, "res_abc");
    expect(await exists(dir)).toBe(false);
  });

  it("removes recursively — nested children go with it", async () => {
    const dir = join(root, "resources", "proj_2", "res_nested");
    await mkdir(join(dir, "a", "b", "c"), { recursive: true });

    await removeGuardedDir(dir, "res_nested");
    expect(await exists(dir)).toBe(false);
  });

  it("REFUSES a path outside the data root", async () => {
    const outside = await mkdtemp(join(tmpdir(), "otterdeploy-outside-"));
    const dir = join(outside, "res_abc");
    await mkdir(dir, { recursive: true });

    await removeGuardedDir(dir, "res_abc");
    expect(await exists(dir)).toBe(true);
  });

  /**
   * The `root + sep` clause, not bare `root`. A sibling whose name merely
   * starts with the root's name is NOT inside it — `startsWith(root)` alone
   * would delete this one.
   */
  it("REFUSES a sibling directory that shares the root's name as a prefix", async () => {
    const evil = `${root}-evil`;
    const dir = join(evil, "res_abc");
    await mkdir(dir, { recursive: true });

    await removeGuardedDir(dir, "res_abc");
    expect(await exists(dir)).toBe(true);
  });

  it("REFUSES a path inside the root that does not end with the id", async () => {
    const dir = join(root, "resources", "proj_3", "res_other");
    await mkdir(dir, { recursive: true });

    await removeGuardedDir(dir, "res_expected");
    expect(await exists(dir)).toBe(true);
  });

  /** A derivation that collapses to the root itself must not wipe the tree. */
  it("REFUSES the data root itself", async () => {
    const keep = join(root, "resources");
    await mkdir(keep, { recursive: true });

    await removeGuardedDir(root, "");
    expect(await exists(root)).toBe(true);
    expect(await exists(keep)).toBe(true);
  });

  it("REFUSES `/` and the empty path", async () => {
    await removeGuardedDir("/", "");
    await removeGuardedDir("", "");
    expect(await exists("/")).toBe(true);
    expect(await exists(root)).toBe(true);
  });

  it("is best-effort — a missing directory resolves rather than throwing", async () => {
    await expect(
      removeGuardedDir(join(root, "resources", "proj_4", "res_gone"), "res_gone"),
    ).resolves.toBeUndefined();
  });
});
