import { describe, expect, it } from "vite-plus/test";

import { checkForType, parseTypeExpr } from "../env-spec-types";

describe("parseTypeExpr", () => {
  it("reads a bare type", () => {
    expect(parseTypeExpr("url")).toEqual({ name: "url", positional: [], keyed: {} });
  });

  it("reads positional and keyed arguments", () => {
    expect(parseTypeExpr("enum(local, cloudflare)")).toEqual({
      name: "enum",
      positional: ["local", "cloudflare"],
      keyed: {},
    });
    expect(parseTypeExpr("string(minLength=32, startsWith=sk-)")).toEqual({
      name: "string",
      positional: [],
      keyed: { minLength: "32", startsWith: "sk-" },
    });
  });

  // The schema's own upload-directory rule: a regex with a comma inside it
  // must not be split on that comma.
  it("keeps a regex literal whole", () => {
    expect(parseTypeExpr("string(matches=/^[a-z,]+$/)")?.keyed.matches).toBe("/^[a-z,]+$/");
  });
});

describe("checkForType", () => {
  const ok = (t: string, v: string) => expect(checkForType(t)?.(v)).toBeNull();
  const bad = (t: string, v: string) => expect(checkForType(t)?.(v)).toBeTruthy();

  it("url wants a scheme", () => {
    ok("url", "https://postiz.example.com");
    bad("url", "postiz.example.com");
    bad("url", "ftp://x");
  });

  it("enum is exact", () => {
    ok("enum(local, cloudflare)", "local");
    bad("enum(local, cloudflare)", "s3");
  });

  it("string constraints compose, first failure wins", () => {
    ok("string(minLength=3, startsWith=sk-)", "sk-abc");
    expect(checkForType("string(minLength=3, startsWith=sk-)")?.("ab")).toBe(
      "must be at least 3 characters",
    );
    expect(checkForType("string(minLength=3, startsWith=sk-)")?.("abc")).toBe(
      "must start with sk-",
    );
  });

  it("matches takes a /pattern/ literal", () => {
    ok("string(matches=/^[^\\/]/)", "uploads");
    bad("string(matches=/^[^\\/]/)", "/uploads");
  });

  it("number, port, boolean", () => {
    ok("number", "30");
    bad("number", "thirty");
    ok("port", "5432");
    bad("port", "70000");
    ok("boolean", "true");
    bad("boolean", "maybe");
  });

  // Honesty: a type we don't judge gives no check rather than a wrong one.
  it("returns null for a type it does not know", () => {
    expect(checkForType("uuid")).toBeNull();
    expect(checkForType("string")).toBeNull();
  });
});
