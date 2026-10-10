import { Temporal } from "@otterdeploy/shared/temporal";
/**
 * Reading a public repo with git alone: the tree, single files, and the cases
 * where git is the wrong answer (unreachable repo, hostile ref) so callers fall
 * back to the API. Real `git` against a real (file://) repository.
 *
 * Why it exists: repo inspection used to cost GitHub REST calls an anonymous
 * caller only gets 60 of an hour.
 */
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { gitReadFile, gitTreeEntries, publicGithubCloneUrl } from "../git-snapshot";

let source = "";
let scratch = "";
let url = "";

async function git(...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-C", source, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    // Isolated from the developer's git config (signing, hooks, templates).
    env: {
      ...Bun.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.test",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.test",
    },
  });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(await new Response(proc.stderr).text());
  return out.trim();
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "git-snapshot-"));
  // Where the module keeps its clones: inside the scratch dir, removed with it.
  vi.stubEnv("TMPDIR", scratch);
  source = join(scratch, "source");
  await mkdir(join(source, "apps/web"), { recursive: true });
  url = `file://${source}`;
  await git("init", "-q", "-b", "main");
  // Let the source honour the blob-less filter, as github.com does.
  await git("config", "uploadpack.allowFilter", "true");
  await git("config", "uploadpack.allowAnySHA1InWant", "true");
  await writeFile(join(source, "package.json"), JSON.stringify({ name: "root" }));
  await writeFile(join(source, "apps/web/package.json"), JSON.stringify({ name: "web" }));
  await writeFile(join(source, "README.md"), "# hello\n");
  await writeFile(join(source, "big.bin"), "x".repeat(2 * 1024 * 1024));
  await git("add", ".");
  await git("commit", "-q", "-m", "one");
  await git("branch", "release/1.x");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});

describe("gitTreeEntries", () => {
  it("lists every file and directory with its kind", async () => {
    const entries = await gitTreeEntries(url, "main");
    expect(entries).not.toBeNull();
    const byPath = new Map((entries ?? []).map((e) => [e.path, e.type]));
    expect(byPath.get("apps")).toBe("dir");
    expect(byPath.get("apps/web")).toBe("dir");
    expect(byPath.get("apps/web/package.json")).toBe("file");
    expect(byPath.get("README.md")).toBe("file");
  });

  it("reads a named branch, slashes included", async () => {
    expect(await gitTreeEntries(url, "release/1.x")).not.toBeNull();
  });

  it("is null for a repo it cannot reach or a branch that is not there", async () => {
    expect(await gitTreeEntries(`${url}-missing`, "main")).toBeNull();
    expect(await gitTreeEntries(url, "no-such-branch")).toBeNull();
  });

  it("refuses names git would read as an option or a pattern", async () => {
    expect(await gitTreeEntries(url, "--upload-pack=touch /tmp/x")).toBeNull();
    expect(await gitTreeEntries(url, "a..b")).toBeNull();
    expect(await gitTreeEntries(url, "*")).toBeNull();
  });
});

describe("gitReadFile", () => {
  it("reads a root file and a nested one", async () => {
    expect(await gitReadFile(url, "main", "package.json")).toEqual({
      status: "ok",
      text: JSON.stringify({ name: "root" }),
    });
    expect(await gitReadFile(url, "main", "apps/web/package.json")).toEqual({
      status: "ok",
      text: JSON.stringify({ name: "web" }),
    });
  });

  it("says missing for a path that is not in the repo, a directory, or an oversized file", async () => {
    expect(await gitReadFile(url, "main", "nope/package.json")).toEqual({ status: "missing" });
    expect(await gitReadFile(url, "main", "apps")).toEqual({ status: "missing" });
    expect(await gitReadFile(url, "main", "big.bin")).toEqual({ status: "missing" });
  });

  it("reads a path as a path, never as a pathspec", async () => {
    expect(await gitReadFile(url, "main", ":(glob)**/package.json")).toEqual({
      status: "missing",
    });
  });

  it("says unavailable (so the caller asks the API) when git cannot reach the repo", async () => {
    expect(await gitReadFile(`${url}-missing`, "main", "package.json")).toEqual({
      status: "unavailable",
    });
  });
});

describe("one clone serves later reads", () => {
  it("answers from the clone it already made when the remote has gone", async () => {
    // Warm the clone, then take the repository away: only a reuse can answer.
    expect(await gitReadFile(url, "release/1.x", "README.md")).toEqual({
      status: "ok",
      text: "# hello\n",
    });
    await rm(source, { recursive: true, force: true });
    expect(await gitReadFile(url, "release/1.x", "README.md")).toEqual({
      status: "ok",
      text: "# hello\n",
    });
    // The tree is in the clone; a file's blob is fetched when it is first read,
    // so one never read before needs the remote and is "unavailable" without it.
    expect(await gitTreeEntries(url, "release/1.x")).not.toBeNull();
    expect(await gitReadFile(url, "release/1.x", "package.json")).toEqual({
      status: "unavailable",
    });
  });
});

describe("publicGithubCloneUrl", () => {
  it("builds the anonymous https URL for plain GitHub names", () => {
    expect(publicGithubCloneUrl("miniflux", "v2")).toBe("https://github.com/miniflux/v2.git");
    expect(publicGithubCloneUrl("a.b-c_d", "x.y")).toBe("https://github.com/a.b-c_d/x.y.git");
  });

  it("is null for anything that is not a plain name", () => {
    expect(publicGithubCloneUrl("-oops", "repo")).toBeNull();
    expect(publicGithubCloneUrl("owner", "re/po")).toBeNull();
    expect(publicGithubCloneUrl("owner", "repo --upload-pack=x")).toBeNull();
    expect(publicGithubCloneUrl("", "repo")).toBeNull();
  });
});

describe("a remote that never answers", () => {
  it("gives up at its limits instead of holding the inspection request", async () => {
    // Accepts the git:// connection and never writes a byte.
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data: () => undefined },
    });
    try {
      const limits = { cloneMs: 300, commandMs: 300 };
      const started = performance.now();
      const remote = `git://127.0.0.1:${server.port}/repo.git`;
      expect(await gitTreeEntries(remote, "main", limits)).toBeNull();
      expect(await gitReadFile(remote, "main", "package.json", limits)).toEqual({
        status: "unavailable",
      });
      expect(performance.now() - started).toBeLessThan(5_000);
    } finally {
      server.stop(true);
    }
  });
});

describe("how long a clone is trusted, and what is left behind", () => {
  async function freshSource(name: string): Promise<string> {
    const dir = join(scratch, name);
    await mkdir(dir, { recursive: true });
    const run = async (...args: string[]) => {
      const proc = Bun.spawn(["git", "-C", dir, ...args], {
        stdout: "ignore",
        stderr: "pipe",
        env: {
          ...Bun.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@example.test",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@example.test",
        },
      });
      if ((await proc.exited) !== 0) throw new Error(await new Response(proc.stderr).text());
    };
    await run("init", "-q", "-b", "main");
    await writeFile(join(dir, "a.txt"), "a");
    await run("add", ".");
    await run("commit", "-q", "-m", "one");
    return dir;
  }

  it("re-reads the remote once the clone is older than its TTL", async () => {
    const dir = await freshSource("ttl-source");
    const remote = `file://${dir}`;
    expect(await gitTreeEntries(remote, "main")).not.toBeNull();

    // The repo disappears: inside the TTL the clone still answers...
    await rm(dir, { recursive: true, force: true });
    expect(await gitTreeEntries(remote, "main")).not.toBeNull();

    // ...past it the remote is asked again, and it is gone.
    const later = Temporal.Now.instant().add({ minutes: 5, milliseconds: 1 });
    const clock = vi.spyOn(Temporal.Now, "instant").mockReturnValue(later);
    try {
      expect(await gitTreeEntries(remote, "main")).toBeNull();
    } finally {
      clock.mockRestore();
    }
  });

  it("sweeps clones nothing will read again", async () => {
    const root = join(scratch, "otterdeploy-git-snapshots");
    const stale = join(root, "stale-leftover");
    await mkdir(stale, { recursive: true });
    const longAgo = Temporal.Now.instant().subtract({ minutes: 31 }).epochMilliseconds / 1000;
    await utimes(stale, longAgo, longAgo);
    const dir = await freshSource("sweep-source");

    // A clone in progress triggers the sweep.
    expect(await gitTreeEntries(`file://${dir}`, "main")).not.toBeNull();
    for (let i = 0; i < 50 && (await readdir(root)).includes("stale-leftover"); i++) {
      await Bun.sleep(20);
    }

    expect(await readdir(root)).not.toContain("stale-leftover");
  });
});
