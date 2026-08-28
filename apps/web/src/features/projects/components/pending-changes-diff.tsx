/**
 * The field-level diff body for one staged change. Grouping/formatting lives
 * in `pending-changes-groups.ts`; `pending-changes-rows.tsx` renders this
 * inside each row's disclosure.
 *
 * This was `ChangeGroupCard`, a self-contained card with its own header and
 * discard button. The rows now own the header (verb, name, summary, discard)
 * and the identity that used to be on the card, so only the body survives.
 *
 * Renders the FULL server diff, not just a verb:
 *   - create  → spec list of what the resource will be created with
 *               (engine/image/repo/ports/domains/env keys…)
 *   - update  → field table (current → new) + per-key env changes
 *   - delete  → the reason when the server gives one (e.g. source-changed)
 *   - env     → each key as its own +/~/− line with values, attached to
 *               the owning service/database card
 */

import type { EnvRow, GroupedChange } from "./pending-changes-groups";

import { clip, renderValue } from "./pending-changes-groups";

export { groupChanges, type DiffChange } from "./pending-changes-groups";

export function ChangeGroupBody({ group }: { group: GroupedChange }) {
  return (
    <div className="flex flex-col gap-2">
      {group.spec.length > 0 && <SpecTable spec={group.spec} />}
      {group.fields.length > 0 && <FieldTable fields={group.fields} />}
      {group.env.length > 0 && <EnvChangeTable rows={group.env} />}
      {group.reason !== undefined && (
        <div className="text-xs text-muted-foreground">{group.reason}</div>
      )}
    </div>
  );
}

// What a create will provision, one row per configured aspect.
function SpecTable({ spec }: { spec: GroupedChange["spec"] }) {
  return (
    <table className="w-full font-mono text-xs">
      <tbody>
        {spec.map((s) => (
          <tr key={s.field}>
            <td className="w-32 py-0.5 pr-3 align-top whitespace-nowrap text-muted-foreground">
              {s.field}
            </td>
            <td className="py-0.5 break-all text-foreground">{s.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FieldTable({ fields }: { fields: GroupedChange["fields"] }) {
  return (
    <table className="w-full font-mono text-xs">
      <thead>
        <tr className="text-muted-foreground">
          <th className="py-1 text-left font-medium">Field</th>
          <th className="py-1 text-left font-medium">Current</th>
          <th className="py-1 text-left font-medium">New</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((f) => (
          <tr key={f.field} className="border-t border-border/40">
            <td className="py-1 pr-3 align-top text-foreground">{f.field}</td>
            <td className="py-1 pr-3 align-top break-all text-muted-foreground">
              {renderValue(f.from)}
            </td>
            <td className="py-1 align-top break-all text-foreground">{renderValue(f.to)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Env changes in the same table shell as fields (Variable / Current / New)
// with a colored +/~/− gutter glyph so add / update / delete still read at a
// glance. Mono keeps the glyph column aligned without an explicit width.
function EnvChangeTable({ rows }: { rows: EnvRow[] }) {
  return (
    <table className="w-full font-mono text-xs">
      <thead>
        <tr className="text-muted-foreground">
          <th className="py-1 text-left font-medium">Variable</th>
          <th className="py-1 text-left font-medium">Current</th>
          <th className="py-1 text-left font-medium">New</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <EnvChangeRow key={`${r.kind}-${r.key}`} row={r} />
        ))}
      </tbody>
    </table>
  );
}

const ENV_SIGN = { create: "+", update: "~", delete: "−" } as const;
const ENV_SIGN_TINT = {
  create: "text-success",
  update: "text-info",
  delete: "text-destructive",
} as const;

function EnvChangeRow({ row }: { row: EnvRow }) {
  const current = row.kind === "update" ? clip(row.from) : "–";
  const next =
    row.kind === "delete"
      ? "–"
      : row.kind === "update"
        ? clip(row.to)
        : row.secret
          ? "${secret} (set server-side)"
          : clip(row.value);
  return (
    <tr className="border-t border-border/40">
      <td className="py-1 pr-3 align-top break-all">
        <span className={`${ENV_SIGN_TINT[row.kind]} font-semibold`} aria-hidden>
          {ENV_SIGN[row.kind]}
        </span>{" "}
        <span
          className={
            row.kind === "delete" ? "text-muted-foreground line-through" : "text-foreground"
          }
        >
          {row.key}
        </span>
      </td>
      <td className="py-1 pr-3 align-top break-all text-muted-foreground">{current}</td>
      <td className="py-1 align-top break-all text-foreground">{next}</td>
    </tr>
  );
}
