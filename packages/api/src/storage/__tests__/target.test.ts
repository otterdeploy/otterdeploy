import { describe, expect, it } from "vite-plus/test";

import type { StorageTarget } from "../target";

import { resolveKey } from "../target";

const scoped: StorageTarget = {
  destinationId: "dest_1",
  name: "backups",
  bucket: "acme",
  region: "eu-central-1",
  endpoint: undefined,
  root: "backups/",
  accessKeyId: "k",
  secretAccessKey: "s",
  sessionToken: undefined,
};

const whole: StorageTarget = { ...scoped, root: "" };

describe("a destination's prefix is a ceiling, not a default", () => {
  it("roots every key under the configured prefix", () => {
    const out = resolveKey(scoped, "2026-08/dump.sql.gz");
    expect(out.isOk() && out.value).toBe("backups/2026-08/dump.sql.gz");
  });

  it("refuses a '..' segment rather than normalising it", () => {
    // Normalising would be worse than refusing: an S3 key may legitimately
    // CONTAIN a literal ".." segment, so rewriting the path would silently
    // address a different object than the caller named.
    for (const key of ["../secrets/prod.env", "a/../../etc/passwd", ".."]) {
      const out = resolveKey(scoped, key);
      expect(out.isErr()).toBe(true);
      expect(out.isErr() && out.error.reason).toBe("denied");
    }
  });

  it("is not fooled by a leading slash", () => {
    // "/etc/passwd" must not become an absolute key that skips the root.
    const out = resolveKey(scoped, "/etc/passwd");
    expect(out.isOk() && out.value).toBe("backups/etc/passwd");
  });

  it("does not let a sibling prefix be reached by name", () => {
    // "backups-old/..." is a DIFFERENT prefix; prefixing keeps it inside.
    const out = resolveKey(scoped, "backups-old/x");
    expect(out.isOk() && out.value).toBe("backups/backups-old/x");
  });

  it("allows any key when no prefix is configured", () => {
    const out = resolveKey(whole, "anything/at/all.txt");
    expect(out.isOk() && out.value).toBe("anything/at/all.txt");
  });

  it("still refuses traversal on an unrooted bucket", () => {
    // No prefix to escape, but a ".." segment is meaningless to S3 anyway and
    // accepting it would make the two code paths disagree.
    expect(resolveKey(whole, "../x").isErr()).toBe(true);
  });
});
