// The two builder-specific build cards: Railpack (package-manager override,
// build command, static root, SPA) and Dockerfile (path + --build-args). Both
// stage into the project manifest through the shared helpers and ride the
// normal pending-changes bar. Dispatched by `ServiceBuildCard` in build-card.tsx.

import type { BuildDockerfileConfig, BuildRailpackConfig } from "@otterdeploy/shared/build-config";

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";

import {
  BuildFieldRow,
  SaveRow,
  type ServiceBuildResource,
  invalidateAfterSave,
  stageBuildConfig,
  trimToNull,
} from "./build-card-shared";

// ─────────────────────────────── Railpack ───────────────────────────────

export function RailpackBuildCard({
  resource,
  config,
}: {
  resource: ServiceBuildResource;
  config: BuildRailpackConfig;
}) {
  const [packageManager, setPackageManager] = useState(config.packageManager ?? "");
  const [buildCommand, setBuildCommand] = useState(config.buildCommand ?? "");
  const [staticRoot, setStaticRoot] = useState(config.staticRoot ?? "");
  const [spa, setSpa] = useState(config.spa ?? false);

  const save = useMutation({
    mutationFn: async () => {
      // Preserve watchPatterns (not edited here); overwrite the rest.
      const nextBuild: BuildRailpackConfig = {
        builder: "railpack",
        ...(config.watchPatterns ? { watchPatterns: config.watchPatterns } : {}),
        packageManager: trimToNull(packageManager),
        buildCommand: trimToNull(buildCommand),
        staticRoot: trimToNull(staticRoot),
        spa: spa ? true : null,
      };
      await stageBuildConfig(resource, nextBuild);
    },
    onSuccess: async () => {
      await invalidateAfterSave(resource.projectId);
      toast.success("Build settings saved", {
        description: "Deploy to rebuild with these settings.",
      });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to save build settings"),
  });

  const dirty =
    (config.packageManager ?? "") !== packageManager ||
    (config.buildCommand ?? "") !== buildCommand ||
    (config.staticRoot ?? "") !== staticRoot ||
    (config.spa ?? false) !== spa;

  return (
    <SettingsCard
      title="Build"
      description="Railpack reads these before building — empty fields auto-detect from the repo. Saved changes apply on the next Deploy."
    >
      <BuildFieldRow
        label="Package manager"
        hint="Override the repo's pin, e.g. bun@1.3.13 or pnpm@9.12.0."
      >
        <Input
          value={packageManager}
          onChange={(e) => setPackageManager(e.target.value)}
          placeholder="auto — repo's packageManager"
          className="h-8 font-mono text-[12.5px]"
          disabled={save.isPending}
        />
      </BuildFieldRow>

      <BuildFieldRow label="Build command" hint="Overrides the detected build step.">
        <Input
          value={buildCommand}
          onChange={(e) => setBuildCommand(e.target.value)}
          placeholder="auto"
          className="h-8 font-mono text-[12.5px]"
          disabled={save.isPending}
        />
      </BuildFieldRow>

      <BuildFieldRow label="Static root" hint="Built-assets dir for static sites (default: dist).">
        <Input
          value={staticRoot}
          onChange={(e) => setStaticRoot(e.target.value)}
          placeholder="dist"
          className="h-8 font-mono text-[12.5px]"
          disabled={save.isPending}
        />
      </BuildFieldRow>

      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2.5">
        <div className="flex flex-col">
          <span className="text-[13px] font-medium">Single-page app</span>
          <span className="text-[11px] text-muted-foreground">
            Serve via Caddy with history fallback to index.html.
          </span>
        </div>
        <Switch checked={spa} disabled={save.isPending} onCheckedChange={(next) => setSpa(next)} />
      </div>

      <SaveRow dirty={dirty} pending={save.isPending} onSave={() => save.mutate()} />
    </SettingsCard>
  );
}

// ────────────────────────────── Dockerfile ──────────────────────────────

interface ArgRow {
  /** Stable identity for React keys — rows are added/removed by position, so
   *  the index is not a safe key. */
  id: string;
  key: string;
  value: string;
}

let argRowSeq = 0;
const newArgRow = (key = "", value = ""): ArgRow => ({
  id: `arg-${argRowSeq++}`,
  key,
  value,
});

/** Fold the editor rows into the `Record<string,string>` the build config
 *  stores. Empty keys are dropped; an empty set persists as null. Keys are
 *  trimmed (clean docker arg names) but values are preserved verbatim —
 *  leading/trailing whitespace can be intentional in a value. */
function rowsToRecord(rows: ArgRow[]): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const { key, value } of rows) {
    const k = key.trim();
    if (k) out[k] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function DockerfileBuildCard({
  resource,
  config,
}: {
  resource: ServiceBuildResource;
  config: BuildDockerfileConfig;
}) {
  const [dockerfilePath, setDockerfilePath] = useState(config.dockerfilePath ?? "");
  const [rows, setRows] = useState<ArgRow[]>(
    Object.entries(config.buildArgs ?? {}).map(([key, value]) => newArgRow(key, value)),
  );

  const save = useMutation({
    mutationFn: async () => {
      const nextBuild: BuildDockerfileConfig = {
        builder: "dockerfile",
        ...(config.watchPatterns ? { watchPatterns: config.watchPatterns } : {}),
        dockerfilePath: trimToNull(dockerfilePath),
        buildArgs: rowsToRecord(rows),
      };
      await stageBuildConfig(resource, nextBuild);
    },
    onSuccess: async () => {
      await invalidateAfterSave(resource.projectId);
      toast.success("Build settings saved", {
        description: "Deploy to rebuild with these settings.",
      });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to save build settings"),
  });

  const initialArgs =
    config.buildArgs && Object.keys(config.buildArgs).length > 0 ? config.buildArgs : null;
  const dirty =
    (config.dockerfilePath ?? "") !== dockerfilePath ||
    JSON.stringify(rowsToRecord(rows)) !== JSON.stringify(initialArgs);

  const setRow = (i: number, patch: Partial<ArgRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));
  const addRow = () => setRows((rs) => [...rs, newArgRow()]);

  return (
    <SettingsCard
      title="Build"
      description="Settings for the Dockerfile build. Saved changes apply on the next Deploy."
    >
      <BuildFieldRow
        label="Dockerfile path"
        hint="Relative to the repo (or service subdir). Default: ./Dockerfile."
      >
        <Input
          value={dockerfilePath}
          onChange={(e) => setDockerfilePath(e.target.value)}
          placeholder="./Dockerfile"
          className="h-8 font-mono text-[12.5px]"
          disabled={save.isPending}
        />
      </BuildFieldRow>

      <div className="flex flex-col gap-2 border-b border-border/40 px-3 py-2.5">
        <div className="flex flex-col">
          <span className="text-[12px] text-foreground">Build args</span>
          <span className="text-[11px] text-muted-foreground">
            Passed as <code className="font-mono">--build-arg</code>. Not secret — they land in the
            image history; use runtime env for secrets.
          </span>
        </div>

        {rows.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {rows.map((row, i) => (
              <div key={row.id} className="flex items-center gap-1.5">
                <Input
                  value={row.key}
                  onChange={(e) => setRow(i, { key: e.target.value })}
                  placeholder="NAME"
                  className="h-8 flex-1 font-mono text-[12.5px]"
                  disabled={save.isPending}
                />
                <span className="text-muted-foreground">=</span>
                <Input
                  value={row.value}
                  onChange={(e) => setRow(i, { value: e.target.value })}
                  placeholder="value"
                  className="h-8 flex-1 font-mono text-[12.5px]"
                  disabled={save.isPending}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-muted-foreground"
                  disabled={save.isPending}
                  onClick={() => removeRow(i)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}

        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7"
            disabled={save.isPending}
            onClick={addRow}
          >
            Add build arg
          </Button>
        </div>
      </div>

      <SaveRow dirty={dirty} pending={save.isPending} onSave={() => save.mutate()} />
    </SettingsCard>
  );
}
