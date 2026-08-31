import { sql } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import {
  DIALECTS,
  dialectForEngine,
  isRelationalEngine,
  mysqlDialect,
  postgresDialect,
} from "../dialects";
import { qualified } from "../query";

describe("registry", () => {
  it("maps every relational engine to a dialect", () => {
    expect(dialectForEngine("postgres")).toBe(postgresDialect);
    expect(dialectForEngine("mariadb")).toBe(mysqlDialect);
    expect(dialectForEngine("clickhouse")).toBeNull();
  });

  it("returns null for engines that are not SQL, rather than a bad fit", () => {
    // Pretending a keyspace is a table is the mistake the "unsupported" card
    // was written to avoid; here it is a type instead of a card.
    expect(dialectForEngine("redis")).toBeNull();
    expect(dialectForEngine("mongodb")).toBeNull();
    expect(isRelationalEngine("redis")).toBe(false);
    expect(isRelationalEngine("postgres")).toBe(true);
  });
});

describe("identifier quoting is delegated to drizzle, per dialect", () => {
  const render = (d: typeof postgresDialect, q: ReturnType<typeof qualified>) =>
    d.compiler().sqlToQuery(q).sql;

  it("escapes the quote character each engine actually uses", () => {
    expect(render(postgresDialect, sql`${sql.identifier('we"ird')}`)).toBe('"we""ird"');
    expect(render(mysqlDialect, sql`${sql.identifier("we`ird")}`)).toBe("`we``ird`");
  });

  it("qualifies with the schema only when the dialect has one", () => {
    expect(render(postgresDialect, qualified(postgresDialect, "public", "orders"))).toBe(
      '"public"."orders"',
    );
    expect(render(postgresDialect, qualified(postgresDialect, "", "orders"))).toBe('"orders"');
  });

  it("does not quote the dot into the name", () => {
    // `sql.identifier("public.orders")` would produce "public.orders" — one
    // table whose name contains a period. Two calls, joined by a literal dot.
    expect(render(postgresDialect, qualified(postgresDialect, "public", "orders"))).not.toBe(
      '"public.orders"',
    );
  });
});

describe("type classification", () => {
  it("keeps int8 exact and int4 a number", () => {
    expect(postgresDialect.classifyType("bigint")).toBe("bigint");
    expect(postgresDialect.classifyType("integer")).toBe("number");
    expect(postgresDialect.classifyType("numeric(10,2)")).toBe("decimal");
  });

  it("separates timestamptz from timestamp, because one has no zone", () => {
    expect(postgresDialect.classifyType("timestamp with time zone")).toBe("instant");
    expect(postgresDialect.classifyType("timestamp without time zone")).toBe("datetime");
  });

  it("recognises both array spellings postgres reports", () => {
    expect(postgresDialect.classifyType("integer[]")).toBe("array");
    expect(postgresDialect.classifyType("_int4")).toBe("array");
  });

  it("reads tinyint(1) as the boolean mysql has no type for", () => {
    expect(mysqlDialect.classifyType("tinyint(1)")).toBe("bool");
    expect(mysqlDialect.classifyType("tinyint(4)")).toBe("number");
    expect(mysqlDialect.classifyType("bigint unsigned")).toBe("bigint");
    expect(mysqlDialect.classifyType("datetime(6)")).toBe("datetime");
  });

  it("strips mysql display widths and numeric attributes", () => {
    // COLUMN_TYPE is the whole declaration, not a bare type name.
    expect(mysqlDialect.classifyType("bigint(20) unsigned")).toBe("bigint");
    expect(mysqlDialect.classifyType("int unsigned zerofill")).toBe("number");
    expect(mysqlDialect.classifyType("decimal(10,2) unsigned")).toBe("decimal");
    // …but a two-word type name is not a type plus an attribute.
    expect(mysqlDialect.classifyType("double precision")).toBe("number");
  });

  it("degrades an unmodelled type to opaque rather than guessing text", () => {
    expect(postgresDialect.classifyType("tsvector")).toBe("opaque");
    expect(postgresDialect.classifyType("some_user_type")).toBe("opaque");
  });
});

describe("read-only enforcement", () => {
  it("enforces postgres read-only per transaction, not via startup parameters", () => {
    // It used to be `-c default_transaction_read_only=on`, but transaction-mode
    // poolers (Neon, PgBouncer) refuse every startup option — the parameter
    // made pooled databases unopenable. Null routes postgres through the same
    // server-enforced READ ONLY transaction wrapper MySQL already uses.
    expect(postgresDialect.readOnlyConnectionParams()).toBeNull();
  });

  it("says honestly when an engine cannot do it at connect time", () => {
    // Null means "connect as a read-only role". It must never be read as
    // "allow writes" — the pool refuses rather than falling back to a
    // statement classifier, which a CTE or a stored procedure defeats.
    expect(mysqlDialect.readOnlyConnectionParams()).toBeNull();
  });

  it("marks postgres as supporting interactive transactions", () => {
    expect(postgresDialect.supportsTransactions).toBe(true);
  });
});

describe("introspection sql", () => {
  it("never counts rows exactly, in any dialect", () => {
    // A navigator that runs count(*) turns opening a database into a full scan.
    for (const d of Object.values(DIALECTS)) {
      expect(d.introspection.tables.toLowerCase()).not.toContain("count(*)");
    }
  });

  it("excludes the engine's own catalog schemas", () => {
    expect(postgresDialect.introspection.tables).toContain("pg_catalog");
    expect(mysqlDialect.introspection.tables).toContain("information_schema");
  });
});
