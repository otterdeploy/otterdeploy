/**
 * Pure grouping + value-formatting layer for the pending-changes bar.
 * Turns the flat server diff (`manifest.diff` changes) into one card-worth
 * of data per resource; `pending-changes-diff.tsx` renders the cards.
 */

export interface DiffChange {
  kind: "create" | "update" | "delete" | "no-op";
  resource: "service" | "database" | "env" | "compose";
  name: string;
  details?: Record<string, unknown>;
}

export interface EnvRow {
  key: string;
  kind: "create" | "update" | "delete";
  // create → value (or secret sentinel); update → from/to
  value?: string;
  from?: string;
  to?: string;
  secret?: boolean;
}

export interface GroupedChange {
  kind: "create" | "update" | "delete";
  resource: "service" | "database" | "compose";
  name: string;
  // For creates: the summary the server attached (engine, image, ports…).
  spec: Array<{ field: string; value: string }>;
  // For updates: { fieldName: { from, to } }. May be empty when the
  // server returned a coarse "update" without a field-level breakdown.
  fields: Array<{ field: string; from: unknown; to: unknown }>;
  // Per-key env changes rolled up under this resource.
  env: EnvRow[];
  // For deletes: server-provided reason (e.g. "source-changed").
  reason?: string;
}

export function groupChanges(changes: DiffChange[]): GroupedChange[] {
  const byKey = new Map<string, GroupedChange>();
  // Resource-level changes first, so env rows can attach to them.
  for (const c of changes) {
    if (c.resource === "env" || c.kind === "no-op") continue;
    const key = `${c.resource}:${c.name}`;
    if (!byKey.has(key)) byKey.set(key, toGroup(c));
  }
  for (const c of changes) {
    if (c.resource === "env") attachEnvRow(byKey, c);
  }
  return [...byKey.values()];
}

function toGroup(c: DiffChange): GroupedChange {
  return {
    kind: c.kind === "no-op" ? "update" : c.kind,
    resource: c.resource === "env" ? "service" : c.resource,
    name: c.name,
    spec: c.kind === "create" ? extractSpec(c.details) : [],
    fields: extractFields(c.details),
    env: [],
    reason: typeof c.details?.reason === "string" ? c.details.reason : undefined,
  };
}

// Env rows carry server-tagged parent/key; the dotted-name parse is a
// fallback for older servers.
function attachEnvRow(byKey: Map<string, GroupedChange>, c: DiffChange): void {
  if (c.kind === "no-op") return;
  const d = (c.details ?? {}) as Record<string, unknown>;
  const dot = c.name.indexOf(".");
  const parentName = dot === -1 ? c.name : c.name.slice(0, dot);
  const group = findOrCreateParent(
    byKey,
    parentName,
    d.parent === "database" ? "database" : "service",
  );
  group.env.push({
    key: typeof d.key === "string" ? d.key : dot === -1 ? c.name : c.name.slice(dot + 1),
    kind: c.kind,
    value: typeof d.value === "string" ? d.value : undefined,
    from: typeof d.from === "string" ? d.from : undefined,
    to: typeof d.to === "string" ? d.to : undefined,
    secret: d.secret === true,
  });
}

function findOrCreateParent(
  byKey: Map<string, GroupedChange>,
  name: string,
  resource: GroupedChange["resource"],
): GroupedChange {
  const existing =
    byKey.get(`service:${name}`) ?? byKey.get(`database:${name}`) ?? byKey.get(`compose:${name}`);
  if (existing) return existing;
  const group: GroupedChange = { kind: "update", resource, name, spec: [], fields: [], env: [] };
  byKey.set(`${resource}:${name}`, group);
  return group;
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

// Create summaries arrive as a flat details object (engine, image, ports,
// envKeys, domains…). Everything except structural keys becomes a spec row.
const SPEC_SKIP = new Set(["fields", "reason"]);

function extractSpec(details: unknown): GroupedChange["spec"] {
  if (!details || typeof details !== "object") return [];
  return Object.entries(details as Record<string, unknown>).flatMap(([field, value]) =>
    !SPEC_SKIP.has(field) && value !== undefined && value !== null
      ? [{ field: specLabel(field), value: renderValue(value) }]
      : [],
  );
}

const SPEC_LABELS: Record<string, string> = {
  envKeys: "env",
  extraEnvKeys: "env",
  sourceSubdir: "subdir",
  imageRepository: "registry image",
  publicEnabled: "public",
  gitRepoUrl: "repo",
};

function specLabel(field: string): string {
  return SPEC_LABELS[field] ?? field;
}

// ─── Value rendering ──────────────────────────────────────────────────

export function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return clip(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number")) {
    return v.join(", ");
  }
  if (Array.isArray(v) && v.length > 0 && v.every(isPortLike)) {
    return v.map(formatPort).join(", ");
  }
  return clip(JSON.stringify(v));
}

// Ports appear in two shapes: manifest ({ container }) and current-state
// ({ containerPort }). Render both as "3000/tcp" instead of raw JSON.
interface PortLike {
  container?: number;
  containerPort?: number;
  protocol?: string;
}

function isPortLike(x: unknown): x is PortLike {
  if (!x || typeof x !== "object") return false;
  const p = x as PortLike;
  return typeof p.container === "number" || typeof p.containerPort === "number";
}

function formatPort(p: PortLike): string {
  return `${p.container ?? p.containerPort}/${p.protocol ?? "tcp"}`;
}

export function clip(v: string | undefined, max = 120): string {
  if (v === undefined) return "—";
  return v.length > max ? `${v.slice(0, max)}…` : v;
}
