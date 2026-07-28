import { describe, expect, test } from "bun:test";

import { DIGEST_ID, shortDigest, splitRef } from "../image-ref";

const DIGEST = "sha256:9f2b0c8d1e4a7b3c5d6e8f0a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4";

describe("shortDigest", () => {
  test("strips the algorithm prefix and truncates", () => {
    expect(shortDigest(DIGEST)).toBe("9f2b0c8");
    expect(shortDigest(DIGEST, DIGEST_ID)).toBe("9f2b0c8d1e4a");
  });

  test("handles a bare hex id (no prefix)", () => {
    expect(shortDigest("9f2b0c8d1e4a7b3c")).toBe("9f2b0c8");
  });

  test("other algorithms lose their prefix too", () => {
    expect(shortDigest("sha512:abcdef1234567890")).toBe("abcdef1");
  });

  test("null for anything that isn't a digest", () => {
    expect(shortDigest(undefined)).toBeNull();
    expect(shortDigest(null)).toBeNull();
    expect(shortDigest("")).toBeNull();
    expect(shortDigest("sha256:")).toBeNull();
  });
});

describe("splitRef", () => {
  test("splits on the final colon", () => {
    expect(splitRef("ghcr.io/owner/app:1.2")).toEqual({ repo: "ghcr.io/owner/app", tag: "1.2" });
    expect(splitRef("nginx:latest")).toEqual({ repo: "nginx", tag: "latest" });
  });

  test("a registry port is not a tag", () => {
    expect(splitRef("localhost:5000/app")).toEqual({ repo: "localhost:5000/app", tag: "" });
    expect(splitRef("localhost:5000/app:1.2")).toEqual({ repo: "localhost:5000/app", tag: "1.2" });
  });

  test("untagged refs keep an empty tag", () => {
    expect(splitRef("nginx")).toEqual({ repo: "nginx", tag: "" });
  });
});
