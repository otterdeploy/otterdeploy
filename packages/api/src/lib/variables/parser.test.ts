import { describe, expect, it } from "vite-plus/test";

import { extractRefs, extractVaultRefs, parseValue } from "./parser";

describe("parseValue", () => {
  it("returns a single literal for an unreferenced string", () => {
    const result = parseValue("postgres://localhost:5432/db");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens).toEqual([{ kind: "literal", value: "postgres://localhost:5432/db" }]);
  });

  it("parses a bare reference", () => {
    const result = parseValue("${{db.DATABASE_URL}}");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens).toEqual([
      {
        kind: "ref",
        resource: "db",
        var: "DATABASE_URL",
        raw: "${{db.DATABASE_URL}}",
      },
    ]);
  });

  it("parses a connection string with multiple refs", () => {
    const result = parseValue(
      "postgres://${{db.PGUSER}}:${{db.PGPASSWORD}}@${{db.PGHOST}}:${{db.PGPORT}}/${{db.PGDATABASE}}",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const refs = result.tokens.filter((t) => t.kind === "ref");
    expect(refs).toHaveLength(5);
  });

  it("handles escaped sequences as literal text", () => {
    const result = parseValue("\\${{not.A_REF}} and ${{actual.REF}}");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const literals = result.tokens.filter((t) => t.kind === "literal");
    const refs = result.tokens.filter((t) => t.kind === "ref");
    expect(literals.map((t) => t.value).join("")).toBe("${{not.A_REF}} and ");
    expect(refs).toHaveLength(1);
    if (refs[0]?.kind !== "ref") return;
    expect(refs[0].resource).toBe("actual");
    expect(refs[0].var).toBe("REF");
  });

  it("errors when the resource name is missing", () => {
    const result = parseValue("${{.FOO}}");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("parse_error");
  });

  it("errors when the variable name is missing", () => {
    const result = parseValue("${{db.}}");
    expect(result.ok).toBe(false);
  });

  it("errors when the closing braces are missing", () => {
    const result = parseValue("${{db.FOO");
    expect(result.ok).toBe(false);
  });

  it("rejects lowercase variable names (must be SCREAMING_SNAKE)", () => {
    const result = parseValue("${{db.foo}}");
    expect(result.ok).toBe(false);
  });

  it("allows dashes and underscores in resource names", () => {
    const result = parseValue("${{my-svc_2.PORT}}");
    expect(result.ok).toBe(true);
  });
});

describe("parseValue: vault references", () => {
  it("parses a three-segment vault reference", () => {
    const result = parseValue("${{vault.prod-vault.app/db:PASSWORD}}");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens).toEqual([
      {
        kind: "vault",
        provider: "prod-vault",
        ref: "app/db:PASSWORD",
        raw: "${{vault.prod-vault.app/db:PASSWORD}}",
      },
    ]);
  });

  it("parses vault refs mixed with literals and resource refs", () => {
    const result = parseValue("pg://u:${{vault.prod.db:pw}}@${{db.PGHOST}}/x");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens.map((t) => t.kind)).toEqual([
      "literal",
      "vault",
      "literal",
      "ref",
      "literal",
    ]);
  });

  it("keeps two-segment refs on a resource named `vault` working", () => {
    const result = parseValue("${{vault.MY_VAR}}");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens).toEqual([
      { kind: "ref", resource: "vault", var: "MY_VAR", raw: "${{vault.MY_VAR}}" },
    ]);
  });

  it("treats an escaped vault reference as literal text", () => {
    const result = parseValue("\\${{vault.prod.db:pw}}");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens[0]).toEqual({ kind: "literal", value: "${{vault.prod.db:pw}}" });
  });

  it("errors when the vault ref segment is missing", () => {
    const result = parseValue("${{vault.prod.}}");
    expect(result.ok).toBe(false);
  });

  it("errors when the closing braces are missing on a vault ref", () => {
    const result = parseValue("${{vault.prod.db:pw");
    expect(result.ok).toBe(false);
  });

  it("allows dotted, dashed, slashed and colon refs", () => {
    const result = parseValue("${{vault.p.kv/team-a/app.prod:DB_URL}}");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens[0]).toMatchObject({ kind: "vault", ref: "kv/team-a/app.prod:DB_URL" });
  });
});

describe("extractVaultRefs", () => {
  it("returns deduped vault refs and excludes resource refs", () => {
    const refs = extractVaultRefs(
      "${{vault.p.a:x}}-${{vault.p.a:x}}-${{vault.q.b}}-${{db.PGHOST}}",
    );
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => `${r.provider}.${r.ref}`).sort()).toEqual(["p.a:x", "q.b"]);
  });

  it("stays out of extractRefs (no dependency-graph edges)", () => {
    const refs = extractRefs("${{vault.p.a:x}} ${{db.PGHOST}}");
    expect(refs).toHaveLength(1);
    expect(refs[0]?.resource).toBe("db");
  });
});

describe("extractRefs", () => {
  it("returns deduped refs", () => {
    const refs = extractRefs("${{db.PGUSER}}-${{db.PGUSER}}-${{db.PGHOST}}-${{other.URL}}");
    expect(refs).toHaveLength(3);
    expect(refs.map((r) => `${r.resource}.${r.var}`).sort()).toEqual([
      "db.PGHOST",
      "db.PGUSER",
      "other.URL",
    ]);
  });

  it("returns empty on parse failure", () => {
    expect(extractRefs("${{bad")).toEqual([]);
  });
});

describe("parseValue: stack-scoped references", () => {
  it("parses an absolute stack ref as stack + compose key + var", () => {
    const result = parseValue("${{autumn.db.HOST}}");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens).toEqual([
      {
        kind: "ref",
        resource: "db",
        stack: { name: "autumn" },
        var: "HOST",
        raw: "${{autumn.db.HOST}}",
      },
    ]);
  });

  it("parses the literal `stack` first segment as the self scope", () => {
    const result = parseValue("postgres://u:p@${{stack.db.HOST}}:5432/x");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ref = result.tokens.find((t) => t.kind === "ref");
    expect(ref).toEqual({
      kind: "ref",
      resource: "db",
      stack: { name: null },
      var: "HOST",
      raw: "${{stack.db.HOST}}",
    });
  });

  it("keeps flat refs flat: VAR must be the final segment", () => {
    const result = parseValue("${{db.HOST}}");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens[0]).toMatchObject({ kind: "ref", resource: "db", var: "HOST" });
    expect(result.tokens[0]).not.toHaveProperty("stack");
  });

  it("reads an uppercase middle segment as the compose key, not the var", () => {
    const result = parseValue("${{autumn.DB_MAIN.HOST}}");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens[0]).toMatchObject({
      kind: "ref",
      resource: "DB_MAIN",
      stack: { name: "autumn" },
      var: "HOST",
    });
  });

  it("leaves the vault form alone", () => {
    const result = parseValue("${{vault.prov.path:field}}");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens[0]).toMatchObject({ kind: "vault", provider: "prov" });
  });

  it("rejects a dangling third segment", () => {
    expect(parseValue("${{a.b.c.D}}").ok).toBe(false);
    expect(parseValue("${{a.b.}}").ok).toBe(false);
  });

  it("dedupes by scope in extractRefs: same key in two stacks stays two refs", () => {
    const refs = extractRefs("${{a.db.HOST}} ${{b.db.HOST}} ${{stack.db.HOST}} ${{db.HOST}}");
    expect(refs).toHaveLength(4);
  });
});
