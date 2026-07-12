/**
 * Challenge-parsing logic for the registry testConnection probe.
 * Header shapes are taken verbatim from real registries (Docker Hub,
 * GHCR, GitLab, Harbor) so the parser is pinned to what's in the wild.
 */

import { describe, expect, it } from "vitest";

import { buildTokenUrl, parseAuthChallenge } from "../test-connection";

describe("parseAuthChallenge", () => {
  it("parses Docker Hub's bearer challenge (realm + service)", () => {
    const challenge = parseAuthChallenge(
      'Bearer realm="https://auth.docker.io/token",service="registry.docker.io"',
    );
    expect(challenge).toEqual({
      scheme: "bearer",
      realm: "https://auth.docker.io/token",
      service: "registry.docker.io",
    });
  });

  it("parses a challenge with a scope parameter", () => {
    const challenge = parseAuthChallenge(
      'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:acme/api:pull"',
    );
    expect(challenge).toEqual({
      scheme: "bearer",
      realm: "https://ghcr.io/token",
      service: "ghcr.io",
      scope: "repository:acme/api:pull",
    });
  });

  it("is case-insensitive on the scheme and tolerates whitespace", () => {
    const challenge = parseAuthChallenge('  bearer realm="https://r.example.com/auth" ');
    expect(challenge).toEqual({ scheme: "bearer", realm: "https://r.example.com/auth" });
  });

  it("parses unquoted parameter values", () => {
    const challenge = parseAuthChallenge(
      "Bearer realm=https://auth.example.com/token,service=example.com",
    );
    expect(challenge).toEqual({
      scheme: "bearer",
      realm: "https://auth.example.com/token",
      service: "example.com",
    });
  });

  it("returns a basic challenge for Basic auth registries (Harbor, plain distribution)", () => {
    expect(parseAuthChallenge('Basic realm="Registry Realm"')).toEqual({ scheme: "basic" });
    expect(parseAuthChallenge("Basic")).toEqual({ scheme: "basic" });
  });

  it("returns null for a missing header", () => {
    expect(parseAuthChallenge(null)).toBeNull();
    expect(parseAuthChallenge("")).toBeNull();
  });

  it("returns null for unsupported schemes", () => {
    expect(parseAuthChallenge("Negotiate")).toBeNull();
    expect(parseAuthChallenge('Digest realm="x", nonce="y"')).toBeNull();
  });

  it("returns null for a bearer challenge without a realm", () => {
    expect(parseAuthChallenge("Bearer")).toBeNull();
    expect(parseAuthChallenge('Bearer service="registry.docker.io"')).toBeNull();
  });
});

describe("buildTokenUrl", () => {
  it("appends service and scope as query params", () => {
    const url = buildTokenUrl({
      scheme: "bearer",
      realm: "https://auth.docker.io/token",
      service: "registry.docker.io",
      scope: "repository:library/nginx:pull",
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://auth.docker.io/token");
    expect(parsed.searchParams.get("service")).toBe("registry.docker.io");
    expect(parsed.searchParams.get("scope")).toBe("repository:library/nginx:pull");
  });

  it("omits absent params and keeps ones baked into the realm", () => {
    const url = buildTokenUrl({
      scheme: "bearer",
      realm: "https://harbor.internal/service/token?client_id=probe",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("client_id")).toBe("probe");
    expect(parsed.searchParams.has("service")).toBe(false);
    expect(parsed.searchParams.has("scope")).toBe(false);
  });

  it("throws on a relative realm so the caller can surface a protocol error", () => {
    expect(() => buildTokenUrl({ scheme: "bearer", realm: "/service/token" })).toThrow();
  });
});
