/**
 * Demo Variables tab body — shared-from-project + service-only env
 * tables. Hardcoded sample data; will be deleted along with the demo
 * cluster when the real per-service variables editor ships.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";

import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

interface EnvVar {
  name: string;
  value: string;
  type: "plain" | "secret";
  scope: "project" | "service";
}

const PROJECT_VARS: EnvVar[] = [
  { name: "NODE_ENV", value: "production", type: "plain", scope: "project" },
  {
    name: "DATABASE_URL",
    value: "postgres://••••@postgres.gravy-truck.internal:5432/app",
    type: "secret",
    scope: "project",
  },
  {
    name: "REDIS_URL",
    value: "redis://redis.gravy-truck.internal:6379/0",
    type: "plain",
    scope: "project",
  },
  {
    name: "SENTRY_DSN",
    value: "••••••••••••••••••",
    type: "secret",
    scope: "project",
  },
];

const SERVICE_VARS: EnvVar[] = [
  { name: "PORT", value: "3000", type: "plain", scope: "service" },
  { name: "LOG_LEVEL", value: "info", type: "plain", scope: "service" },
];

export function VariablesTabBody({ projectName }: { projectName: string }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border border-border/40">
        <div className="flex items-start justify-between gap-3 px-5 py-4">
          <div>
            <div className="text-[14px] font-semibold">Shared from project</div>
            <div className="mt-0.5 text-[12.5px] text-muted-foreground">
              Inherited by every service in{" "}
              <span className="font-semibold text-foreground/80">{projectName}</span>
              . Edit at the project level.
            </div>
          </div>
          <Button variant="outline" size="sm">
            Open project vars
          </Button>
        </div>
        <div className="divide-y divide-border/30 border-t border-border/30">
          {PROJECT_VARS.map((v) => (
            <VarRow key={v.name} v={v} action="override" />
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border/40">
        <div className="flex items-start justify-between gap-3 px-5 py-4">
          <div>
            <div className="text-[14px] font-semibold">api-only</div>
            <div className="mt-0.5 text-[12.5px] text-muted-foreground">
              Visible only to this service. Overrides project vars with the same
              key.
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5">
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
            Add variable
          </Button>
        </div>
        <div className="divide-y divide-border/30 border-t border-border/30">
          {SERVICE_VARS.map((v) => (
            <VarRow key={v.name} v={v} action="edit" />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <span className="text-[12.5px] text-muted-foreground">
          Changes apply on next deploy.
        </span>
        <Button size="sm">Apply & redeploy</Button>
      </div>
    </div>
  );
}

function VarRow({ v, action }: { v: EnvVar; action: "override" | "edit" }) {
  return (
    <div className="grid grid-cols-[160px_1fr_80px_80px_80px] items-center gap-4 px-5 py-2.5">
      <span className="font-mono text-[12.5px] text-foreground/80">{v.name}</span>
      <span
        className={cn(
          "truncate font-mono text-xs",
          v.type === "secret"
            ? "rounded bg-muted/60 px-1.5 py-0.5 text-muted-foreground"
            : "text-muted-foreground",
        )}
      >
        {v.value}
      </span>
      <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground/60">
        {v.type}
      </span>
      <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground/60">
        {v.scope}
      </span>
      <button
        type="button"
        className="text-left font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {action === "override" ? "↪ override" : "edit"}
      </button>
    </div>
  );
}
