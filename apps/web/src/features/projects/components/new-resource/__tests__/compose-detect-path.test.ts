/**
 * Rules behind the Compose-file field's `onChangeAsync` validator.
 *
 * Auto-detection only ever helps the operator who leaves the field blank. The
 * one who types a path is the one most able to get it subtly wrong. The
 * `.yaml`/`.yml` near-miss above all, and that typo used to be silent until
 * the build went looking for a file that was never there.
 */

import { describe, expect, it } from "vite-plus/test";

import type { RepoEntry } from "../compose-detect-path";

import {
  joinRepoPath,
  listingPathIssue,
  splitRepoPath,
  staticPathIssue,
  trimSlashes,
} from "../compose-detect-path";

const file = (name: string): RepoEntry => ({ name, type: "file" });
const dir = (name: string): RepoEntry => ({ name, type: "dir" });

describe("splitRepoPath", () => {
  it("splits a nested path into directory and filename", () => {
    expect(splitRepoPath("deploy/compose.yml")).toEqual({ dir: "deploy", base: "compose.yml" });
    expect(splitRepoPath("a/b/c/docker-compose.yml")).toEqual({
      dir: "a/b/c",
      base: "docker-compose.yml",
    });
  });

  it("treats a bare filename as living in the current directory", () => {
    expect(splitRepoPath("compose.yml")).toEqual({ dir: "", base: "compose.yml" });
  });

  it("tolerates stray slashes and whitespace", () => {
    expect(splitRepoPath("  /deploy/compose.yml  ")).toEqual({
      dir: "deploy",
      base: "compose.yml",
    });
  });
});

describe("joinRepoPath", () => {
  it("joins a subdir with a path inside it", () => {
    expect(joinRepoPath("apps/web", "deploy")).toBe("apps/web/deploy");
  });

  it("drops empty parts rather than emitting stray slashes", () => {
    expect(joinRepoPath("", "deploy")).toBe("deploy");
    expect(joinRepoPath("apps/web", "")).toBe("apps/web");
    expect(joinRepoPath("", "")).toBe("");
  });

  it("normalizes slashes on both sides", () => {
    expect(joinRepoPath("/apps/web/", "/deploy/")).toBe("apps/web/deploy");
  });
});

describe("staticPathIssue", () => {
  it("passes a blank field: blank is the auto-detect case", () => {
    expect(staticPathIssue("")).toBeUndefined();
    expect(staticPathIssue("   ")).toBeUndefined();
  });

  it("passes an ordinary relative path", () => {
    expect(staticPathIssue("docker-compose.yml")).toBeUndefined();
    expect(staticPathIssue("deploy/compose.yaml")).toBeUndefined();
  });

  it("rejects an absolute path", () => {
    expect(staticPathIssue("/etc/compose.yml")).toContain("relative to the repository");
  });

  it("rejects a path climbing out of the repository", () => {
    expect(staticPathIssue("../compose.yml")).toContain("stay inside the repository");
    expect(staticPathIssue("deploy/../../compose.yml")).toContain("stay inside the repository");
  });

  it("does not reject a filename that merely contains dots", () => {
    expect(staticPathIssue("docker-compose.prod.yml")).toBeUndefined();
    expect(staticPathIssue("..hidden/compose.yml")).toBeUndefined();
  });
});

describe("listingPathIssue", () => {
  it("passes when the file is there", () => {
    expect(listingPathIssue("docker-compose.yml", [file("docker-compose.yml")])).toBeUndefined();
  });

  it("suggests the near-miss on the .yaml/.yml typo", () => {
    // The typo this validator exists for.
    const msg = listingPathIssue("docker-compose.yaml", [file("docker-compose.yml")]);
    expect(msg).toContain("docker-compose.yaml");
    expect(msg).toContain('Did you mean "docker-compose.yml"');
  });

  it("suggests by the shared precedence, not listing order", () => {
    const entries = [file("docker-compose.yml"), file("compose.yml")];
    expect(listingPathIssue("stack.yml", entries)).toContain('Did you mean "compose.yml"');
  });

  it("says so plainly when there is nothing to suggest", () => {
    const msg = listingPathIssue("compose.yml", [file("Dockerfile"), file("package.json")]);
    expect(msg).toBe('No "compose.yml" in this directory.');
  });

  it("distinguishes a directory from a missing file", () => {
    expect(listingPathIssue("compose", [dir("compose")])).toBe(
      '"compose" is a directory, not a file.',
    );
  });

  it("does not suggest a directory that merely shares the name", () => {
    // A `compose.yml/` directory is not a compose file.
    const msg = listingPathIssue("stack.yml", [dir("compose.yml")]);
    expect(msg).toBe('No "stack.yml" in this directory.');
  });

  it("passes an unconventional filename that genuinely exists", () => {
    // Operators may keep the stack anywhere; the field is free-form on purpose.
    expect(listingPathIssue("stack.yml", [file("stack.yml")])).toBeUndefined();
  });
});

describe("trimSlashes", () => {
  it("strips both ends without touching the middle", () => {
    expect(trimSlashes("/a/b/")).toBe("a/b");
    expect(trimSlashes("a/b")).toBe("a/b");
    expect(trimSlashes("///")).toBe("");
  });
});
