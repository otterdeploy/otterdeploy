// Step_Version — pick a database engine version and set the service name.
// Ported verbatim from apps/web-demo/src/features/otterstack/screens/new-service.tsx lines 1508-1602.
import type { AnyFieldApi } from "@tanstack/react-form";

import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { type ServiceKind } from "@/features/projects/data/service-kinds";
import { DatabaseLogo } from "@/shared/components/brand/database-logo";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";

import { SectionH, Field } from "./form-primitives";

type VersionProps = {
  kind: ServiceKind;
  version: string | null;
  setVersion: (v: string) => void;
  nameField: AnyFieldApi;
};

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
      <SectionH
        title={`${kind.name} version`}
        sub="Pick a major version — minor versions are auto-upgraded during maintenance windows"
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 10,
          marginTop: 12,
        }}
      >
        {(kind.versions ?? []).map((v, i) => (
          <button
            key={v}
            type="button"
            onClick={() => setVersion(v)}
            className={`os-builder ${version === v ? "active" : ""}`}
          >
            {i === 0 && <span className="os-builder-pop">latest</span>}
            <div className="flex items-center gap-2">
              <div className="os-builder-icon">
                <DatabaseLogo value={kind.id} size={14} />
              </div>
              <span style={{ fontWeight: 600, fontSize: 14 }} className="font-mono">
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
            <div
              className="text-muted-foreground"
              style={{ fontSize: 11, marginTop: 6, lineHeight: 1.4 }}
            >
              {i === 0
                ? "Newest stable release · all features available"
                : i === 1
                  ? "Long-term support · stable for production"
                  : "Older release · only choose for legacy compatibility"}
            </div>
          </button>
        ))}
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="Database name" />
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
            <div className="text-muted-foreground" style={{ fontSize: 11, marginTop: 4 }}>
              Reachable at{" "}
              <span className="font-mono" style={{ color: "var(--foreground)" }}>
                {name || kind.id}.internal:{port}
              </span>
            </div>
          </Field>
        </CardContent>
      </Card>
    </>
  );
}
