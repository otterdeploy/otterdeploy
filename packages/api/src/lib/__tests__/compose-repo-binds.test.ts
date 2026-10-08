/**
 * a git stack's bind sources are copied out of the build
 * checkout, which is deleted when the build ends. n8n's
 * `./init-data.sh:/docker-entrypoint-initdb.d/init-data.sh` was dropped, so
 * Postgres never created the role n8n logs in as.
 */
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

import { stageRepoBindSources } from "../compose-materialize";

let scratch: string;
let checkout: string;
let stackDir: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "repo-binds-"));
  checkout = join(scratch, "checkout", "docker-compose", "withPostgres");
  stackDir = join(scratch, "stack", "repo");
  await mkdir(checkout, { recursive: true });
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("stageRepoBindSources", () => {
  test("a script in the repo is copied where the bind can reach it", async () => {
    await writeFile(join(checkout, "init-data.sh"), "#!/bin/bash\necho init\n", { mode: 0o755 });
    const staged = await stageRepoBindSources(["./init-data.sh"], checkout, stackDir);
    expect([...staged.staged]).toEqual(["./init-data.sh"]);
    expect(staged.absent).toEqual([]);
    const copy = join(stackDir, "init-data.sh");
    expect(await readFile(copy, "utf8")).toBe("#!/bin/bash\necho init\n");
    // Postgres runs it from docker-entrypoint-initdb.d: keep it executable.
    expect((await stat(copy)).mode & 0o111).not.toBe(0);
  });

  test("a folder is copied whole, and a redeploy replaces the old copy", async () => {
    await mkdir(join(checkout, "config"));
    await writeFile(join(checkout, "config", "a.conf"), "one");
    await stageRepoBindSources(["./config"], checkout, stackDir);
    await rm(join(checkout, "config", "a.conf"));
    await writeFile(join(checkout, "config", "b.conf"), "two");
    await stageRepoBindSources(["./config"], checkout, stackDir);
    expect(await readFile(join(stackDir, "config", "b.conf"), "utf8")).toBe("two");
    await expect(stat(join(stackDir, "config", "a.conf"))).rejects.toThrow();
  });

  test("a data dir compose would create, and a host path, are not the repo's", async () => {
    const staged = await stageRepoBindSources(["./library", "/etc/localtime"], checkout, stackDir);
    expect(staged.staged.size).toBe(0);
    // The absolute path is a host bind, decided by lib/host-binds.ts.
    expect(staged.absent).toEqual(["./library"]);
  });

  test("a source that leaves the compose file's folder is refused", async () => {
    await writeFile(join(scratch, "checkout", "outside.txt"), "x");
    const staged = await stageRepoBindSources(["../../outside.txt"], checkout, stackDir);
    expect(staged.absent).toEqual(["../../outside.txt"]);
  });

  test("a symlink committed to the repo cannot point the copy at the host", async () => {
    const secret = join(scratch, "host-secret");
    await writeFile(secret, "root:x:0:0");
    await symlink(secret, join(checkout, "passwd"));
    const staged = await stageRepoBindSources(["./passwd"], checkout, stackDir);
    expect(staged.absent).toEqual(["./passwd"]);
    await expect(stat(join(stackDir, "passwd"))).rejects.toThrow();
  });
});
