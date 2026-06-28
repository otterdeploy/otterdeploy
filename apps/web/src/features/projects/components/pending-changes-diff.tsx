/**
 * Diff grouping + per-resource diff cards for the pending-changes bar.
 * Split out of pending-changes-bar.tsx to keep that file under the
 * max-lines cap. The bar imports `groupChanges` + `ChangeGroupCard`.
 */

export interface DiffChange {
  kind: "create" | "update" | "delete" | "no-op";
  resource: "service" | "database" | "env" | "compose";
  name: string;
  details?: Record<string, unknown>;
}

// ─── Grouping ─────────────────────────────────────────────────────────

interface GroupedChange {
  kind: "create" | "update" | "delete";
  resource: "service" | "database" | "compose";
  name: string;
  // For updates: { fieldName: { from, to } }. May be empty when the
  // server returned a coarse "update" without a field-level breakdown.
  fields: Array<{ field: string; from: unknown; to: unknown }>;
  // Number of env-level changes rolled into this group (set/unset).
  envChanges: number;
}

export function groupChanges(changes: DiffChange[]): GroupedChange[] {
  const byKey = new Map<string, GroupedChange>();
  for (const c of changes) {
    if (c.resource === "env") {
      // env keys are emitted as `${serviceName}.${KEY}`.
      const parent = c.name.split(".")[0] ?? c.name;
      const key = `service:${parent}`;
      const existing =
        byKey.get(key) ??
        ({
          kind: "update",
          resource: "service",
          name: parent,
          fields: [],
          envChanges: 0,
        } as GroupedChange);
      existing.envChanges += 1;
      byKey.set(key, existing);
      continue;
    }
    const key = `${c.resource}:${c.name}`;
    if (byKey.has(key)) continue;
    const fieldEntries = extractFields(c.details);
    byKey.set(key, {
      kind: c.kind === "no-op" ? "update" : c.kind,
      resource: c.resource,
      name: c.name,
      fields: fieldEntries,
      envChanges: 0,
    });
  }
  return [...byKey.values()];
}

function extractFields(details: unknown): GroupedChange["fields"] {
  if (!details || typeof details !== "object") return [];
  const fields = (details as { fields?: unknown }).fields;
  if (!fields || typeof fields !== "object") return [];
  return Object.entries(fields as Record<string, unknown>).map(([field, value]) => {
    const v = value as { from?: unknown; to?: unknown };
    return { field, from: v.from, to: v.to };
  });
}

// ─── Per-group card ───────────────────────────────────────────────────

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
  const settingsCount = group.fields.length + group.envChanges;
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
        {settingsCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {settingsCount} {settingsCount === 1 ? "setting" : "settings"}
          </span>
        )}
      </div>
      {(group.fields.length > 0 || group.envChanges > 0) && (
        <div className="border-t px-3 py-2">
          {group.fields.length > 0 && <FieldTable fields={group.fields} />}
          {group.envChanges > 0 && (
            <div className="mt-1 text-xs text-muted-foreground">
              {group.envChanges} environment variable
              {group.envChanges === 1 ? "" : "s"} changed
            </div>
          )}
        </div>
      )}
    </div>
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
            <td className="py-1 text-foreground">{f.field}</td>
            <td className="py-1 text-muted-foreground">{renderValue(f.from)}</td>
            <td className="py-1 text-foreground">{renderValue(f.to)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}
