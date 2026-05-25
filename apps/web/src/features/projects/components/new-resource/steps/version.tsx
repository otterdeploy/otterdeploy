import { useStore } from "@tanstack/react-form";

import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { type ServiceKind } from "@/features/projects/data/service-kinds";
import { DatabaseLogo } from "@/shared/components/brand/database-logo";
import { Card, CardContent } from "@/shared/components/ui/card";
import { cn } from "@/shared/lib/utils";

import {
  SectionHeader,
  builderCardClass,
  builderCardActiveClass,
  builderIconClass,
  builderPopClass,
} from "../form-primitives";
import { useFormContext } from "../form-context";

interface StepVersionProps {
  kind: ServiceKind;
}

export function StepVersion({ kind }: StepVersionProps) {
  const form = useFormContext();
  const version = useStore(form.store, (s) => s.values.version as string | null);
  const name = useStore(form.store, (s) => s.values.name as string);

  const port =
    kind.id === "postgres"
      ? 5432
      : kind.id === "mysql"
        ? 3306
        : kind.id === "redis"
          ? 6379
          : kind.id === "mongodb"
            ? 27017
            : kind.id === "clickhouse"
              ? 9000
              : "auto";

  return (
    <>
      <SectionHeader
        title={`${kind.name} version`}
        sub="Pick a major version — minor versions are auto-upgraded during maintenance windows"
      />
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {(kind.versions ?? []).map((v, i) => (
          <button
            key={v}
            type="button"
            onClick={() => form.setFieldValue("version", v)}
            className={cn(builderCardClass, version === v && builderCardActiveClass)}
          >
            {i === 0 && <span className={builderPopClass}>latest</span>}
            <div className="flex items-center gap-2">
              <div className={builderIconClass}>
                <DatabaseLogo value={kind.id} size={14} />
              </div>
              <span className="font-mono text-sm font-semibold">
                {kind.id} {v}
              </span>
              {version === v && (
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  strokeWidth={2}
                  className="ml-auto size-4 text-success"
                />
              )}
            </div>
            <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              {i === 0
                ? "Newest stable release · all features available"
                : i === 1
                  ? "Long-term support · stable for production"
                  : "Older release · only choose for legacy compatibility"}
            </div>
          </button>
        ))}
      </div>

      <div className="h-[18px]" />
      <SectionHeader title="Database name" />
      <Card className="mt-2.5 rounded-md">
        <CardContent>
          <form.AppField name="name">
            {(f) => (
              <f.TextField
                label="Service name"
                className="font-mono"
                description={`Reachable at ${name || kind.id}.internal:${port}`}
              />
            )}
          </form.AppField>
        </CardContent>
      </Card>
    </>
  );
}
