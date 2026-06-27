import { describe, expect, it } from "vitest";

import { isSecretSentinel, parseRefs, ManifestRefError } from "../refs";

describe("parseRefs", () => {
  it("returns no refs for a plain string", () => {
    expect(parseRefs("hello")).toEqual([]);
    expect(parseRefs("")).toEqual([]);
  });

  it("recognizes the secret sentinel", () => {
    expect(parseRefs("${secret}")).toEqual([{ kind: "secret" }]);
    expect(isSecretSentinel("${secret}")).toBe(true);
    expect(isSecretSentinel("  ${secret}  ")).toBe(true);
    expect(isSecretSentinel("prefix${secret}")).toBe(false);
  });

  it("parses database refs", () => {
    expect(parseRefs("${database:primary.url}")).toEqual([
      { kind: "database", name: "primary", field: "url" },
    ]);
    expect(parseRefs("${database:cache.host}")).toEqual([
      { kind: "database", name: "cache", field: "host" },
    ]);
  });

  it("parses service env refs", () => {
    expect(parseRefs("${service:web.PORT}")).toEqual([
      { kind: "service-env", name: "web", key: "PORT" },
    ]);
  });

  it("parses service host/port", () => {
    expect(parseRefs("${service:web.host}")).toEqual([
      { kind: "service", name: "web", field: "host" },
    ]);
    expect(parseRefs("${service:web.port}")).toEqual([
      { kind: "service", name: "web", field: "port" },
    ]);
    expect(parseRefs("${service:web.port.admin}")).toEqual([
      { kind: "service", name: "web", field: "port", portName: "admin" },
    ]);
  });

  it("parses interpolated values with multiple refs", () => {
    const value = "postgres://acme:${database:primary.password}@${database:primary.host}:5432/acme";
    expect(parseRefs(value)).toEqual([
      { kind: "database", name: "primary", field: "password" },
      { kind: "database", name: "primary", field: "host" },
    ]);
  });

  it("rejects unknown database fields", () => {
    expect(() => parseRefs("${database:primary.nope}")).toThrow(ManifestRefError);
  });

  it("rejects unknown namespaces", () => {
    expect(() => parseRefs("${unknown:foo.bar}")).toThrow(ManifestRefError);
  });

  it("rejects refs missing a field", () => {
    expect(() => parseRefs("${database:primary}")).toThrow(ManifestRefError);
  });
});
