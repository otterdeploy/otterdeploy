// Step_Version — pick a database engine version and set the service name.
// Ported verbatim from apps/web-demo/src/features/otterstack/screens/new-service.tsx lines 1508-1602.
import type { AnyFieldApi } from "@tanstack/react-form";
import { DatabaseLogo } from "@/shared/components/brand/database-logo";
import { type ServiceKindDef } from "@/features/projects/data/service-kinds";
import { I } from "./icons";
import { SectionH, Field } from "./form-primitives";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";

type VersionProps = {
  kind: ServiceKindDef;
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
            <div className="os-row os-gap-2">
              <div className="os-builder-icon">
                <DatabaseLogo value={kind.id} size={14} />
              </div>
              <span style={{ fontWeight: 600, fontSize: 14 }} className="os-mono">
                {kind.id} {v}
              </span>
              {version === v && (
                <I.check
                  width={12}
                  height={12}
                  style={{ marginLeft: "auto", color: "var(--foreground)" }}
                />
              )}
            </div>
            <div className="os-muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.4 }}>
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
      <Card style={{ marginTop: 10 }}>
        <CardContent>
          <Field label="Service name">
            <Input
              className="font-mono"
              value={name}
              onChange={(e) => nameField.handleChange(e.target.value)}
              onBlur={nameField.handleBlur}
            />
            {nameField.state.meta.errors.length > 0 && (
              <div style={{ fontSize: 11, color: "var(--destructive)", marginTop: 2 }}>
                {nameField.state.meta.errors.join(", ")}
              </div>
            )}
            <div className="os-muted" style={{ fontSize: 11, marginTop: 4 }}>
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
