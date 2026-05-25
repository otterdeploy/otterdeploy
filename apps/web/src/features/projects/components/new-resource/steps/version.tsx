// Step_Version — pick a database engine version and set the service name.
// Ported verbatim from apps/web-demo/src/features/otterstack/screens/new-service.tsx lines 1508-1602.
import type { AnyFieldApi } from "@tanstack/react-form";

import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { type ServiceKind } from "@/features/projects/data/service-kinds";
import { DatabaseLogo } from "@/shared/components/brand/database-logo";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

import {
  SectionHeader,
  Field,
  builderCardClass,
  builderCardActiveClass,
  builderIconClass,
  builderPopClass,
} from "../form-primitives";

interface VersionProps {
  kind: ServiceKind;
  version: string | null;
  setVersion: (v: string) => void;
  nameField: AnyFieldApi;
}

export function StepVersion({ kind, version, setVersion, nameField }: VersionProps) {
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

  const name = (nameField.state.value as string) ?? "";

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
            onClick={() => setVersion(v)}
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
          <Field label="Service name">
            <Input
              className="font-mono"
              value={name}
              onChange={(e) => nameField.handleChange(e.target.value)}
              onBlur={nameField.handleBlur}
            />
            {nameField.state.meta.errors.length > 0 && (
              <div className="mt-0.5 text-[11px] text-destructive">
                {nameField.state.meta.errors.join(", ")}
              </div>
            )}
            <div className="mt-1 text-[11px] text-muted-foreground">
              Reachable at{" "}
              <span className="font-mono text-foreground">
                {name || kind.id}.internal:{port}
              </span>
            </div>
          </Field>
        </CardContent>
      </Card>
    </>
  );
}
