/**
 * Floating "Apply N change(s)" pill — sits below the top nav whenever
 * the saved manifest diverges from current resources.
 *
 * Reads from manifest.diff (same diff CLI `status` uses), so the UI
 * and CLI agree on what "pending" means:
 *   - wizard create staged (no apply)
 *   - postgres delete staged (no apply)
 *   - CLI `sync --preview` saved without apply
 *   - resources drifted out-of-band
 *
 * Click the count to expand into a per-resource diff view that names
 * the change (create / update / delete), lists the field-level
 * current → new values for updates, and surfaces per-resource discard.
 * Deploy = manifest.apply. Discard = manifest.discard.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { markAppliedCreates } from "@/features/projects/components/graph/applied-creates-store";
import { orpc, queryClient } from "@/shared/server/orpc";

interface PendingChangesBarProps {
  projectId: ProjectId;
  environment?: string;
}

type DiffChange = {
  kind: "create" | "update" | "delete" | "no-op";
  resource: "service" | "database" | "env" | "compose";
  name: string;
  details?: Record<string, unknown>;
};

export function PendingChangesBar({ projectId, environment }: PendingChangesBarProps) {
  const [expanded, setExpanded] = useState(false);

  const diff = useQuery(
    orpc.project.manifest.diff.queryOptions({
      input: { projectId, environment },
      refetchInterval: 5_000,
    }),
  );

  const refreshAll = async () => {
    await Promise.all([
      // Partial-input invalidation — the graph layout queries diff
      // without `environment` in its input, so a key matching only
      // projectId catches both that query and the bar's own
      // (projectId, environment) query. Otherwise the graph keeps the
      // ghost create-node until its 5s refetchInterval catches up.
      queryClient.invalidateQueries({
        queryKey: orpc.project.manifest.diff.queryKey({
          input: { projectId },
        }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.project.manifest.get.queryKey({ input: { id: projectId } }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.project.resource.list.queryKey({ input: { projectId } }),
      }),
    ]);
  };

  const apply = async () => {
    // Bridge the graph's ghost nodes BEFORE kicking off apply, not after.
    // apply() drains each resource's create stream, so the call runs for
    // seconds — and manifest.diff keeps polling on its 5s cadence the whole
    // time. The instant a create's DB row inserts (mid-stream), the next diff
    // poll stops reporting it as a create; if the resource-list poll hasn't
    // landed the row yet, the node belongs to neither source and blinks out,
    // then back when the row arrives. Recording the create keys up front keeps
    // those ghosts pinned across the entire apply + the post-apply refetch gap.
    // Skipped creates stay ghosts via the diff's own create list anyway, and a
    // 30s TTL evicts any key whose resource never lands. See applied-creates-store.
    const appliedCreateKeys = (diff.data?.changes ?? [])
      .filter((c) => c.kind === "create" && c.resource !== "env")
      .map((c) => `${c.resource}:${c.name}`);
    markAppliedCreates(projectId, appliedCreateKeys);

    try {
      const result = await orpc.project.manifest.apply.call({ projectId, environment });

      await refreshAll();

      // The reconciler reports per-resource failures in `skipped[]` rather
      // than throwing — a create that hits a missing build binding or an
      // unresolved ${secret} lands here, not in the catch. Surfacing it is
      // the difference between "Deploy did nothing and the pill is stuck
      // forever" and an actionable error.
      if (result.skipped.length > 0) {
        const detail = result.skipped
          .map((s) => `${s.resource} ${s.name}: ${s.reason}`)
          .join("; ");
        if (result.appliedCount === 0) {
          // Nothing landed — keep the bar open so the operator can fix the
          // cause (e.g. bind the project's repo/registry) and retry.
          toast.error(`Nothing deployed — ${detail}`);
          return;
        }
        toast.warning(
          `Applied ${result.appliedCount}, skipped ${result.skipped.length} — ${detail}`,
        );
      } else {
        toast.success(`Applied ${result.appliedCount} change(s)`);
      }
      setExpanded(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message || "Apply failed");
    }
  };

  const discard = async () => {
    try {
      await orpc.project.manifest.discard.call({ projectId });
      toast.success("Pending changes discarded");
      await refreshAll();
      setExpanded(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message || "Discard failed");
    }
  };

  const meaningful = (diff.data?.changes ?? []).filter(
    (c): c is DiffChange => c.kind !== "no-op",
  );
  if (meaningful.length === 0) return null;

  // Group by (resource kind + name). One named resource may produce
  // multiple `env` rows; they all roll up under the parent service for
  // display so the user sees "service api will be updated · 2 vars".
  const groups = groupChanges(meaningful);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-40 flex justify-center">
      <div
        className={`pointer-events-auto flex flex-col items-stretch overflow-hidden rounded-2xl border bg-card/95 shadow-lg backdrop-blur ${
          expanded ? "w-[min(640px,calc(100vw-2rem))]" : ""
        }`}
      >
        <div className="flex items-center gap-3 px-4 py-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:opacity-80"
            aria-expanded={expanded}
          >
            <span
              className={`inline-block transition-transform ${expanded ? "rotate-90" : ""}`}
              aria-hidden
            >
              ▸
            </span>
            Apply {meaningful.length} change{meaningful.length === 1 ? "" : "s"}
          </button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void discard()}
            disabled={diff.isFetching}
          >
            Discard
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={() => void apply()}
            disabled={diff.isFetching}
          >
            Deploy
          </Button>
        </div>
        {expanded && (
          <div className="max-h-[60vh] overflow-auto border-t bg-muted/30">
            <ul className="flex flex-col gap-3 p-3">
              {groups.map((g, i) => (
                <li key={`${g.resource}-${g.name}-${i}`}>
                  <ChangeGroupCard group={g} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
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

function groupChanges(changes: DiffChange[]): GroupedChange[] {
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

function ChangeGroupCard({ group }: { group: GroupedChange }) {
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
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
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
    <table className="w-full text-xs font-mono">
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
