/**
 * Per-resource diff cards for the pending-changes bar. Grouping/formatting
 * lives in `pending-changes-groups.ts`; the bar imports `groupChanges` +
 * `ChangeGroupCard`.
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

export function ChangeGroupCard({ group }: { group: GroupedChange }) {
  const verb = {
    create: "will be created",
    update: "will be updated",
    delete: "will be deleted",
  }[group.kind];
  const tint = {
    create: "text-success",
    update: "text-info",
    delete: "text-destructive",
  }[group.kind];
  const changeCount = group.fields.length + group.env.length;
  const hasBody = group.spec.length > 0 || changeCount > 0 || group.reason !== undefined;
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
            {group.resource}
          </span>
          <span className="font-mono font-medium text-foreground">{group.name}</span>
          <span className={tint}>{verb}</span>
        </div>
        {group.kind === "update" && changeCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {changeCount} {changeCount === 1 ? "change" : "changes"}
          </span>
        )}
      </div>
      {hasBody && (
        <div className="flex flex-col gap-2 border-t px-3 py-2">
          {group.spec.length > 0 && <SpecTable spec={group.spec} />}
          {group.fields.length > 0 && <FieldTable fields={group.fields} />}
          {group.env.length > 0 && <EnvChangeList rows={group.env} />}
          {group.reason !== undefined && (
            <div className="text-xs text-muted-foreground">{group.reason}</div>
          )}
        </div>
      )}
    </div>
  );
}

// What a create will provision — one row per configured aspect.
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

// Each env key on its own +/~/− line with its value(s), like a VCS diff.
function EnvChangeList({ rows }: { rows: EnvRow[] }) {
  return (
    <div className="flex flex-col gap-0.5 font-mono text-xs">
      {rows.map((r) => (
        <EnvChangeLine key={`${r.kind}-${r.key}`} row={r} />
      ))}
    </div>
  );
}

function EnvChangeLine({ row }: { row: EnvRow }) {
  if (row.kind === "delete") {
    return (
      <div className="flex gap-2">
        <span className="text-destructive">−</span>
        <span className="break-all text-muted-foreground line-through">{row.key}</span>
      </div>
    );
  }
  if (row.kind === "update") {
    return (
      <div className="flex gap-2">
        <span className="text-info">~</span>
        <span className="break-all">
          <span className="text-foreground">{row.key}</span>
          <span className="text-muted-foreground"> {clip(row.from)} → </span>
          <span className="text-foreground">{clip(row.to)}</span>
        </span>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <span className="text-success">+</span>
      <span className="break-all">
        <span className="text-foreground">{row.key}</span>
        <span className="text-muted-foreground">
          {" = "}
          {row.secret ? "${secret} (set server-side)" : clip(row.value)}
        </span>
      </span>
    </div>
  );
}
