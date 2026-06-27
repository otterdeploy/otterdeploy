import { describe, expect, it } from "vitest";

import { extractRefs, parseValue } from "./parser";

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
