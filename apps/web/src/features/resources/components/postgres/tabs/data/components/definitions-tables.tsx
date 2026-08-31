/**
 * The three Definitions tables: indexes, constraints, enums.
 *
 * Presentation only — the view next door owns which section is showing and what
 * is typed in the filter. Split for size, and because these are the parts most
 * likely to grow a column as more of each catalog is surfaced.
 */
import { formatBytes } from "@otterdeploy/shared/format";

import { cn } from "@/shared/lib/utils";

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-3 text-[12.5px] text-muted-foreground">{children}</p>;
}

function qualified(schema: string, table: string): string {
  return schema === "" || schema === "public" ? table : `${schema}.${table}`;
}

function filterNamed<T>(rows: readonly T[], needle: string, text: (row: T) => string): T[] {
  if (needle === "") return [...rows];
  return rows.filter((row) => text(row).toLowerCase().includes(needle));
}

export function IndexTable({
  rows,
  needle,
}: {
  rows: ReadonlyArray<{
    schema: string;
    table: string;
    name: string;
    columns: string[];
    isUnique: boolean;
    isPrimary: boolean;
    definition: string | null;
    sizeBytes: number | null;
  }>;
  needle: string;
}) {
  const shown = filterNamed(rows, needle, (row) => `${row.table} ${row.name}`);
  if (shown.length === 0) return <Note>No indexes match.</Note>;
  return (
    <Table head={["table", "index", "columns", "kind", "size"]}>
      {shown.map((r) => (
        <tr key={`${r.schema}.${r.table}.${r.name}`} className="hover:bg-muted/30">
          <Td>{qualified(r.schema, r.table)}</Td>
          <Td title={r.definition ?? undefined}>{r.name}</Td>
          <Td>{r.columns.join(", ") || "—"}</Td>
          <Td>{r.isPrimary ? <Badge>primary</Badge> : r.isUnique ? <Badge>unique</Badge> : "—"}</Td>
          <Td className="text-right">{formatBytes(r.sizeBytes)}</Td>
        </tr>
      ))}
    </Table>
  );
}

const CONSTRAINT_LABEL: Record<string, string> = {
  primary_key: "primary key",
  foreign_key: "foreign key",
  unique: "unique",
  check: "check",
  exclusion: "exclusion",
};

export function ConstraintTable({
  rows,
  needle,
}: {
  rows: ReadonlyArray<{
    schema: string;
    table: string;
    name: string;
    type: string;
    columns: string[];
    definition: string | null;
    referencedTable: { schema: string; name: string } | null;
  }>;
  needle: string;
}) {
  const shown = filterNamed(rows, needle, (row) => `${row.table} ${row.name}`);
  if (shown.length === 0) return <Note>No constraints match.</Note>;
  return (
    <Table head={["table", "constraint", "type", "columns", "references"]}>
      {shown.map((r) => (
        <tr key={`${r.schema}.${r.table}.${r.name}`} className="hover:bg-muted/30">
          <Td>{qualified(r.schema, r.table)}</Td>
          <Td title={r.definition ?? undefined}>{r.name}</Td>
          <Td>
            <Badge>{CONSTRAINT_LABEL[r.type] ?? r.type}</Badge>
          </Td>
          <Td>{r.columns.join(", ") || "—"}</Td>
          <Td>
            {r.referencedTable ? qualified(r.referencedTable.schema, r.referencedTable.name) : "—"}
          </Td>
        </tr>
      ))}
    </Table>
  );
}

export function EnumTable({
  rows,
  needle,
}: {
  rows: ReadonlyArray<{ schema: string; name: string; values: string[] }>;
  needle: string;
}) {
  const shown = filterNamed(rows, needle, (row) => row.name);
  if (rows.length === 0) {
    // Not an error: MySQL's enums are an inline column type rather than a
    // catalog object, so there is genuinely nothing to list.
    return <Note>This engine has no enum types as catalog objects.</Note>;
  }
  if (shown.length === 0) return <Note>No enums match.</Note>;
  return (
    <Table head={["type", "values"]}>
      {shown.map((r) => (
        <tr key={`${r.schema}.${r.name}`} className="hover:bg-muted/30">
          <Td>{qualified(r.schema, r.name)}</Td>
          <Td>{r.values.join(", ")}</Td>
        </tr>
      ))}
    </Table>
  );
}

function Table({ head, children }: { head: readonly string[]; children: React.ReactNode }) {
  return (
    <table className="w-full border-separate border-spacing-0">
      <thead>
        <tr>
          {head.map((h) => (
            <th
              key={h}
              className="sticky top-0 z-10 border-b bg-muted/40 px-3 py-1.5 text-left font-mono text-[11px] font-medium text-muted-foreground"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Td({
  children,
  className,
  title,
}: {
  children?: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <td
      title={title}
      className={cn("truncate border-b px-3 py-1.5 font-mono text-[12px]", className)}
    >
      {children}
    </td>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}
