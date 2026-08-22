// Dockerfile build card: path, build context anchor, and --build-args.
//
// "Build context" is a separate question from where the Dockerfile lives. A
// monorepo Dockerfile sits in the app's subdirectory but COPYs the root
// lockfile and the sibling packages it depends on, so it has to be built from
// the repo root. Auto reads the Dockerfile's COPY sources and escalates only
// when they demand it; the explicit options are the escape hatch.

import type {
  BuildDockerfileConfig,
  DockerfileContextMode,
} from "@otterdeploy/shared/build-config";

import { useState } from "react";

import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

import { BuildSelect, useSaveBuild } from "./build-card-save";
import { BuildFieldRow, SaveRow, type ServiceBuildResource, trimToNull } from "./build-card-shared";

const CONTEXT_OPTIONS = [
  ["auto", "Auto (detect from COPY paths)"],
  ["subdir", "Root directory"],
  ["root", "Repository root"],
] as const satisfies readonly (readonly [DockerfileContextMode, string])[];

interface ArgRow {
  /** Stable identity for React keys: rows are added/removed by position, so
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
 *  trimmed (clean docker arg names) but values are preserved verbatim.
 *  Leading/trailing whitespace can be intentional in a value. */
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
  const [context, setContext] = useState<DockerfileContextMode>(config.dockerfileContext ?? "auto");
  const [rows, setRows] = useState<ArgRow[]>(() =>
    Object.entries(config.buildArgs ?? {}).map(([key, value]) => newArgRow(key, value)),
  );

  const save = useSaveBuild(resource);
  const nextBuild = (): BuildDockerfileConfig => ({
    builder: "dockerfile",
    ...(config.watchPatterns ? { watchPatterns: config.watchPatterns } : {}),
    dockerfilePath: trimToNull(dockerfilePath),
    dockerfileContext: context === "auto" ? null : context,
    buildArgs: rowsToRecord(rows),
  });

  const initialArgs =
    config.buildArgs && Object.keys(config.buildArgs).length > 0 ? config.buildArgs : null;
  const dirty =
    (config.dockerfilePath ?? "") !== dockerfilePath ||
    (config.dockerfileContext ?? "auto") !== context ||
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

      <BuildFieldRow
        label="Build context"
        hint="Which folder buildx sees. Monorepo Dockerfiles usually need the repository root, for the lockfile and sibling packages."
      >
        <BuildSelect
          value={context}
          onChange={setContext}
          options={CONTEXT_OPTIONS}
          disabled={save.isPending}
        />
      </BuildFieldRow>

      <div className="flex flex-col gap-2 border-b border-border/40 px-3 py-2.5">
        <div className="flex flex-col">
          <span className="text-[12px] text-foreground">Build args</span>
          <span className="text-[11px] text-muted-foreground">
            Passed as <code className="font-mono">--build-arg</code>. Not secret: they land in the
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

      <SaveRow dirty={dirty} pending={save.isPending} onSave={() => save.mutate(nextBuild())} />
    </SettingsCard>
  );
}
