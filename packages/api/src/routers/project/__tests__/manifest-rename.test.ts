/**
 * Renaming a resource has to carry its references with it.
 *
 * A name is an address: other resources reach this one through
 * `${database:primary.url}` / `${service:api.host}`. Moving the manifest key
 * without rewriting those refs leaves a document that still validates and
 * breaks at deploy time on an unresolvable ref. The worst place to find out.
 */

import { describe, expect, it } from "vite-plus/test";

import type { Manifest } from "../../../stack/manifest";

import { renameInManifest, rewriteRefsInValue } from "../manifest-rename";

function manifest(parts: Partial<Manifest> = {}): Manifest {
  return {
    version: 1,
    project: "store",
    services: {},
    databases: {},
    composes: {},
    ...parts,
  } as Manifest;
}

const svc = (env: Record<string, string> = {}) => ({ source: "git", repo: "me/api", env }) as never;
const database = (extraEnv: Record<string, string> = {}) =>
  ({ engine: "postgres", version: "18", extraEnv }) as never;

describe("rewriteRefsInValue", () => {
  it("rewrites a plain database ref", () => {
    expect(rewriteRefsInValue("${database:primary.url}", "database", "primary", "main")).toBe(
      "${database:main.url}",
    );
  });

  it("rewrites refs embedded mid-string, more than once", () => {
    const value = "postgres://u:${database:db.password}@${database:db.host}:5432/acme";
    expect(rewriteRefsInValue(value, "database", "db", "core")).toBe(
      "postgres://u:${database:core.password}@${database:core.host}:5432/acme",
    );
  });

  it("keeps the field tail intact, including named ports", () => {
    expect(rewriteRefsInValue("${service:api.port.metrics}", "service", "api", "gateway")).toBe(
      "${service:gateway.port.metrics}",
    );
  });

  it("does not rewrite a different resource of the same kind", () => {
    expect(rewriteRefsInValue("${database:other.url}", "database", "primary", "main")).toBe(
      "${database:other.url}",
    );
  });

  it("does not rewrite the same name under a different kind", () => {
    // A service and a database may not share a name, but the rewrite must not
    // rely on that: it targets one kind.
    expect(rewriteRefsInValue("${service:api.host}", "database", "api", "core")).toBe(
      "${service:api.host}",
    );
  });

  it("does not rewrite a name that merely starts with the old one", () => {
    // `api` must not match inside `api-worker`.
    expect(rewriteRefsInValue("${service:api-worker.host}", "service", "api", "gateway")).toBe(
      "${service:api-worker.host}",
    );
  });

  it("leaves the secret sentinel and plain text alone", () => {
    expect(rewriteRefsInValue("${secret}", "database", "primary", "main")).toBe("${secret}");
    expect(rewriteRefsInValue("just a string", "database", "primary", "main")).toBe(
      "just a string",
    );
  });

  it("survives a malformed token elsewhere in the value", () => {
    // A rename must not be the operation that refuses to run because some
    // unrelated value has a typo.
    const value = "${not a real ref} and ${database:primary.url}";
    expect(rewriteRefsInValue(value, "database", "primary", "main")).toBe(
      "${not a real ref} and ${database:main.url}",
    );
  });
});

describe("renameInManifest", () => {
  it("moves the entry and rewrites every reference to it", () => {
    const out = renameInManifest({
      manifest: manifest({
        databases: { primary: database() },
        services: { api: svc({ DATABASE_URL: "${database:primary.url}" }) },
      }),
      kind: "database",
      from: "primary",
      to: "main",
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.manifest.databases?.main).toBeDefined();
    expect(out.manifest.databases?.primary).toBeUndefined();
    expect(out.manifest.services?.api?.env?.DATABASE_URL).toBe("${database:main.url}");
  });

  it("rewrites refs held in another database's extraEnv", () => {
    const out = renameInManifest({
      manifest: manifest({
        databases: { primary: database(), cache: database({ UP: "${database:primary.host}" }) },
      }),
      kind: "database",
      from: "primary",
      to: "main",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.manifest.databases?.cache?.extraEnv?.UP).toBe("${database:main.host}");
  });

  it("preserves key order so the rename doesn't reshuffle the manifest", () => {
    const out = renameInManifest({
      manifest: manifest({ services: { a: svc(), b: svc(), c: svc() } }),
      kind: "service",
      from: "b",
      to: "z",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(Object.keys(out.manifest.services ?? {})).toEqual(["a", "z", "c"]);
  });

  it("refuses a name already used by another resource of the same kind", () => {
    const out = renameInManifest({
      manifest: manifest({ services: { api: svc(), web: svc() } }),
      kind: "service",
      from: "api",
      to: "web",
    });
    expect(out).toEqual({ ok: false, error: { code: "name-taken" } });
  });

  it("refuses a name used by a DIFFERENT kind, one DNS namespace", () => {
    // `${service:x.host}` and a database called `x` would be two answers to
    // the same question.
    const out = renameInManifest({
      manifest: manifest({ services: { api: svc() }, databases: { core: database() } }),
      kind: "service",
      from: "api",
      to: "core",
    });
    expect(out).toEqual({ ok: false, error: { code: "name-taken" } });
  });

  it("refuses to rename something that isn't there", () => {
    const out = renameInManifest({
      manifest: manifest({ services: { api: svc() } }),
      kind: "service",
      from: "ghost",
      to: "x",
    });
    expect(out).toEqual({ ok: false, error: { code: "not-found" } });
  });

  it("refuses a no-op rename", () => {
    const out = renameInManifest({
      manifest: manifest({ services: { api: svc() } }),
      kind: "service",
      from: "api",
      to: "api",
    });
    expect(out).toEqual({ ok: false, error: { code: "same-name" } });
  });

  it("does not mutate the input manifest", () => {
    const input = manifest({
      databases: { primary: database() },
      services: { api: svc({ URL: "${database:primary.url}" }) },
    });
    renameInManifest({ manifest: input, kind: "database", from: "primary", to: "main" });
    expect(input.databases?.primary).toBeDefined();
    expect(input.services?.api?.env?.URL).toBe("${database:primary.url}");
  });

  it("renames a compose stack without touching env refs", () => {
    // Compose stacks aren't ref-addressable; only the key moves.
    const out = renameInManifest({
      manifest: manifest({
        composes: { stack: { file: "x" } as never },
        services: { api: svc({ K: "${service:stack.host}" }) },
      }),
      kind: "compose",
      from: "stack",
      to: "infra",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.manifest.composes?.infra).toBeDefined();
    expect(out.manifest.services?.api?.env?.K).toBe("${service:stack.host}");
  });
});
