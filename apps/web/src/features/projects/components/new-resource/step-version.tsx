// Step_Version — pick a database engine version and set the service name.
// Change 4: Tailwind conversion.
import type { AnyFieldApi } from "@tanstack/react-form";
import { DatabaseLogo } from "@/shared/components/brand/database-logo";
import { type ServiceKindDef } from "@/features/projects/data/service-kinds";
import { I } from "./icons";
import { SectionH, Field } from "./form-primitives";
import { cn } from "@/shared/lib/utils";

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
      <div className="grid grid-cols-2 gap-[10px] mt-3">
        {(kind.versions ?? []).map((v, i) => (
          <button
            key={v}
            type="button"
            onClick={() => setVersion(v)}
            className={cn(
              "relative p-[14px] bg-card border border-border rounded-lg cursor-pointer text-left font-[inherit] text-foreground hover:border-ring",
              version === v && "border-foreground shadow-[0_0_0_1px_var(--foreground)_inset] bg-accent",
            )}
          >
            {i === 0 && (
              <span className="absolute top-2 right-2 text-[9px] uppercase tracking-[0.08em] px-1.5 py-px rounded-[3px] bg-[oklch(from_var(--info)_l_c_h_/_12%)] text-[var(--info)]">
                latest
              </span>
            )}
            <div className="flex items-center gap-2">
              <div className="w-[26px] h-[26px] rounded-[5px] bg-muted border border-border grid place-items-center text-muted-foreground">
                <DatabaseLogo value={kind.id} size={14} />
              </div>
              <span className="font-semibold text-sm font-mono">
                {kind.id} {v}
              </span>
              {version === v && (
                <I.check
                  width={12}
                  height={12}
                  className="ml-auto text-foreground"
                />
              )}
            </div>
            <div className="text-muted-foreground text-[11px] mt-1.5 leading-[1.4]">
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
      <SectionH title="Database name" />
      <div className="card p-4 mt-[10px]">
        <Field label="Service name">
          <input
            className="input font-mono"
            value={name}
            onChange={(e) => nameField.handleChange(e.target.value)}
            onBlur={nameField.handleBlur}
          />
          {nameField.state.meta.errors.length > 0 && (
            <div className="text-[11px] text-destructive mt-0.5">
              {nameField.state.meta.errors.join(", ")}
            </div>
          )}
          <div className="text-muted-foreground text-[11px] mt-1">
            Reachable at{" "}
            <span className="font-mono text-foreground">
              {name || kind.id}.internal:{port}
            </span>
          </div>
        </Field>
      </div>
    </>
  );
}
