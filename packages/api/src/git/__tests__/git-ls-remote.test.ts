/**
 * The anonymous head lookup's fallback: `git ls-remote` against a real
 * (local, file://) repository with a branch, a lightweight tag and an
 * annotated tag, plus the output parser on its own.
 *
 * Why it exists: GitHub's REST API answers an
 * anonymous caller 60 times an hour per IP, so after a few public-repo deploys
 * every next one failed "GitHub commit lookup failed (403)".
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { lsRemoteSha, shaFromLsRemote } from "../git-ls-remote";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

describe("shaFromLsRemote", () => {
  it("prefers the branch, then an annotated tag's peeled commit, then the tag", () => {
    const out = [`${A}\trefs/tags/v1`, `${B}\trefs/tags/v1^{}`, `${C}\trefs/heads/main`].join("\n");
    expect(shaFromLsRemote(out, "main")).toBe(C);
    expect(shaFromLsRemote(out, "v1")).toBe(B);
    expect(shaFromLsRemote(`${A}\trefs/tags/v2\n`, "v2")).toBe(A);
  });

  it("does not take a longer ref that merely ends in the name", () => {
    expect(shaFromLsRemote(`${A}\trefs/heads/feature/main\n`, "main")).toBeNull();
    expect(shaFromLsRemote("", "main")).toBeNull();
  });
});

describe("lsRemoteSha against a real repository", () => {
  let dir = "";
  let url = "";
  const shas = { main: "", light: "", annotatedCommit: "" };

  async function git(...args: string[]): Promise<string> {
    const proc = Bun.spawn(["git", "-C", dir, ...args], {
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
    dir = await mkdtemp(join(tmpdir(), "ls-remote-"));
    url = `file://${dir}`;
    await git("init", "-q", "-b", "main");
    await git("commit", "-q", "--allow-empty", "-m", "one");
    shas.light = await git("rev-parse", "HEAD");
    await git("tag", "1.0.0");
    await git("commit", "-q", "--allow-empty", "-m", "two");
    shas.annotatedCommit = await git("rev-parse", "HEAD");
    await git("tag", "-a", "@scope/pkg@2.0.0", "-m", "release");
    await git("commit", "-q", "--allow-empty", "-m", "three");
    shas.main = await git("rev-parse", "HEAD");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("resolves a branch, a lightweight tag and an annotated tag to their commits", async () => {
    expect(await lsRemoteSha(url, "main")).toBe(shas.main);
    expect(await lsRemoteSha(url, "1.0.0")).toBe(shas.light);
    expect(await lsRemoteSha(url, "@scope/pkg@2.0.0")).toBe(shas.annotatedCommit);
  });

  it("answers a full SHA with itself and refuses names git would misread", async () => {
    expect(await lsRemoteSha(url, A)).toBe(A);
    expect(await lsRemoteSha(url, "--upload-pack=touch /tmp/x")).toBeNull();
    expect(await lsRemoteSha(url, "a..b")).toBeNull();
    expect(await lsRemoteSha(url, "*")).toBeNull();
  });

  it("answers null for an unknown ref or an unreachable repository", async () => {
    expect(await lsRemoteSha(url, "nope")).toBeNull();
    expect(await lsRemoteSha(`file://${dir}-missing`, "main")).toBeNull();
  });
});

describe("lsRemoteSha against a remote that never answers", () => {
  it("gives up at its timeout instead of holding the deploy request", async () => {
    // Accepts the git:// connection and never writes a byte.
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data: () => undefined },
    });
    try {
      const started = performance.now();
      const sha = await lsRemoteSha(`git://127.0.0.1:${server.port}/repo.git`, "main", 300);
      expect(sha).toBeNull();
      expect(performance.now() - started).toBeLessThan(5_000);
    } finally {
      server.stop(true);
    }
  });
});
