/**
 * Read-only detail panel for a resource that's pending creation — a
 * staged-create ghost the operator clicked on the graph before applying.
 *
 * There's no backend resource yet, so everything shown here comes from the
 * manifest diff's create-change `details` (the same summary the pending-changes
 * bar reads). It's intentionally a preview: a header that matches the real
 * resource panels for visual continuity, the staged config, and a nudge to
 * Apply. Once applied, the node keeps its `${kind}:${name}` id and the route
 * resolves to the real panel automatically.
 */

import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type {
  ResourceEngine,
  ResourceNodeData,
} from "@/features/projects/components/graph/resource-node";

import { Button } from "@/shared/components/ui/button";

import { PanelIcon, SectionLabel } from "./atoms";

export interface StagedCreate {
  kind: "create";
  resource: "service" | "database";
  name: string;
  details?: Record<string, unknown>;
}

const KNOWN_ENGINES: ResourceEngine[] = [
  "postgres",
  "mysql",
  "mariadb",
  "redis",
  "mongodb",
  "docker",
];

function asEngine(v: unknown): ResourceEngine | undefined {
  return typeof v === "string" && (KNOWN_ENGINES as string[]).includes(v)
    ? (v as ResourceEngine)
    : undefined;
}

/** Ordered, human-labelled rows derived from the diff's create `details`.
 *  Unknown keys are skipped — `details` is a loose record, so we only surface
 *  the fields the diff summarizer is known to emit. */
function rows(c: StagedCreate): Array<{ label: string; value: string }> {
  const d = c.details ?? {};
  const out: Array<{ label: string; value: string }> = [];
  const push = (label: string, value: string | undefined | null) => {
    if (value !== undefined && value !== null && value !== "") {
      out.push({ label, value });
    }
  };

  if (c.resource === "service") {
    const source = typeof d.source === "string" ? d.source : undefined;
    push(
      "Source",
      source === "git" ? "Git repository" : source === "image" ? "Container image" : source,
    );
    push("Image", typeof d.image === "string" ? d.image : undefined);
    push("Subdirectory", typeof d.sourceSubdir === "string" ? d.sourceSubdir : undefined);
    push("Replicas", typeof d.replicas === "number" ? String(d.replicas) : undefined);
    if (Array.isArray(d.ports) && d.ports.length > 0) {
      // Manifest port shape: { container: number; protocol?: "tcp"|"udp"; … }.
      const labels = d.ports
        .map((p) => {
          const port = p as { container?: number; protocol?: string };
          if (typeof port.container !== "number") return null;
          return port.protocol && port.protocol !== "tcp"
            ? `${port.container}/${port.protocol}`
            : String(port.container);
        })
        .filter((s): s is string => s !== null);
      if (labels.length > 0) {
        push(labels.length === 1 ? "Port" : "Ports", labels.join(", "));
      }
    }
  } else {
    push("Engine", asEngine(d.engine) ?? (typeof d.engine === "string" ? d.engine : undefined));
    push("Version", typeof d.version === "string" ? d.version : undefined);
    push("Public", d.publicEnabled === true ? "Exposed" : undefined);
  }
  return out;
}

/** Env var keys (names only — the diff never carries values). */
function envKeys(c: StagedCreate): string[] {
  const d = c.details ?? {};
  const raw = c.resource === "service" ? d.envKeys : d.extraEnvKeys;
  return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : [];
}

export function StagedResourcePanel({
  change,
  onClose,
}: {
  change: StagedCreate;
  onClose: () => void;
}) {
  const node: ResourceNodeData = {
    kind: change.resource,
    name: change.name,
    description: "",
    engine: change.resource === "database" ? asEngine(change.details?.engine) : undefined,
  };
  const fields = rows(change);
  const keys = envKeys(change);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-6 pt-6">
        <div className="flex items-start gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Back to graph"
            onClick={onClose}
            className="mt-1"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-4" />
          </Button>
          <PanelIcon node={node} />
          <div className="flex flex-col gap-0.5">
            <span className="text-xl leading-none font-bold tracking-tight">{change.name}</span>
            <span className="font-mono text-xs text-muted-foreground capitalize">
              {change.resource}
            </span>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
          <span className="size-1.5 rounded-full bg-success" />
          Pending creation
        </span>
      </div>

      <div className="flex flex-col gap-5 overflow-auto px-6 pt-6 pb-8">
        <p className="text-sm text-foreground/70">
          This {change.resource} is staged and hasn&apos;t been applied yet. Deploy the pending
          changes to create it.
        </p>

        {fields.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <SectionLabel>Staged configuration</SectionLabel>
            <dl className="overflow-hidden rounded-xl border">
              {fields.map((f, i) => (
                <div
                  key={f.label}
                  className={`flex items-baseline justify-between gap-4 px-3.5 py-2.5 text-sm ${
                    i > 0 ? "border-t" : ""
                  }`}
                >
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="truncate text-right font-mono text-foreground">{f.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {keys.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <SectionLabel>
              Environment · {keys.length} {keys.length === 1 ? "variable" : "variables"}
            </SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {keys.map((k) => (
                <span
                  key={k}
                  className="rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs text-muted-foreground"
                >
                  {k}
                </span>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground/70">
              Values are hidden until the resource is created.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
