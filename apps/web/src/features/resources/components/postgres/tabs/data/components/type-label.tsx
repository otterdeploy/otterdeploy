/**
 * Muted type-tone for column-type labels (Columns popover, Structure view, row
 * detail): one quiet hue per type family, per the reference viewer. Tones stay
 * desaturated so the accent budget (DESIGN.md) is untouched.
 */

import { cn } from "@/shared/lib/utils";

function typeToneClass(type: string): string {
  if (/bool/.test(type)) return "text-amber-600 dark:text-amber-500";
  if (/int|numeric|real|double|decimal|money|serial/.test(type)) {
    return "text-emerald-600 dark:text-emerald-500";
  }
  if (/json/.test(type)) return "text-purple-600 dark:text-purple-400";
  if (/uuid/.test(type)) return "text-sky-600 dark:text-sky-500";
  return "text-muted-foreground";
}

/**
 * Postgres reports the SQL-standard spelling; engineers read and write the
 * internal one.
 *
 * `format_type` says `timestamp without time zone`, which is 27 characters of
 * mostly-noise in a 150px column header — and nobody writing a migration types
 * it. `timestamptz` is the name in the schema file, in the docs, and in your
 * head, so that is the name shown.
 */
const SHORT_TYPES = new Map<string, string>([
  ["timestamp without time zone", "timestamp"],
  ["timestamp with time zone", "timestamptz"],
  ["time without time zone", "time"],
  ["time with time zone", "timetz"],
  ["character varying", "varchar"],
  ["character", "char"],
  ["double precision", "float8"],
  ["bigint", "int8"],
  ["integer", "int4"],
  ["smallint", "int2"],
  ["boolean", "bool"],
  ["bit varying", "varbit"],
]);

export function shortTypeName(type: string): string {
  // Types carry a modifier the abbreviation has to survive: `character
  // varying(255)` → `varchar(255)`, `numeric(12,2)` → unchanged.
  const open = type.indexOf("(");
  const base = (open === -1 ? type : type.slice(0, open)).trim();
  const rest = open === -1 ? "" : type.slice(open);
  // MySQL hangs attributes off the end (`bigint(20) unsigned`); keep them.
  const [head, ...attrs] = base.split(" unsigned");
  const short = SHORT_TYPES.get(base) ?? SHORT_TYPES.get(head ?? base) ?? base;
  const unsigned = attrs.length > 0 || base.endsWith(" unsigned") ? " unsigned" : "";
  return `${short}${rest}${unsigned}`;
}

/** Small mono type label, tone-colored ("varchar", "int4", …). */
export function TypeLabel({ type, className }: { type: string; className?: string }) {
  return (
    <span className={cn("font-mono text-[10px]", typeToneClass(type), className)}>
      {shortTypeName(type)}
    </span>
  );
}
