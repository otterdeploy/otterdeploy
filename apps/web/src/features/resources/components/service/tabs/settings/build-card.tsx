// Build settings for a git-sourced railpack service. Edits the railpack
// build config (package-manager override, build command, static root, SPA)
// and stages it into the project manifest — same manifest.get → patch →
// manifest.save path as the danger zone, so the change rides the normal
// pending-changes bar and applies + rebuilds on the next Deploy. Build
// config only matters at build time, so there's no live mutation.
//
// Railpack already detects the package manager + version from the repo; the
// override exists only to escape a bad/unwanted pin (e.g. a repo stuck on
// bun@1.3.1, whose native install fails on Linux ARM64).

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import type {
  BuildConfig,
  BuildRailpackConfig,
} from "@otterdeploy/shared/build-config";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import { orpc, queryClient } from "@/shared/server/orpc";

import { SettingsCard } from "@/features/resources/components/_shared/settings-card";

/** The resource-list contract types `buildConfig` as `unknown` (consumers
 *  that don't care ignore it), so narrow it here before reading railpack
 *  fields. Returns null for image / dockerfile / compose / auto services. */
function asRailpackConfig(buildConfig: unknown): BuildRailpackConfig | null {
  return buildConfig != null &&
    typeof buildConfig === "object" &&
    (buildConfig as { builder?: string }).builder === "railpack"
    ? (buildConfig as BuildRailpackConfig)
    : null;
}

interface ServiceBuildResource {
  projectId: string;
  name: string;
  buildConfig?: unknown;
}

export function ServiceBuildCard({
  resource,
}: {
  resource: ServiceBuildResource;
}) {
  const railpack = asRailpackConfig(resource.buildConfig);

  const [packageManager, setPackageManager] = useState(
    railpack?.packageManager ?? "",
  );
  const [buildCommand, setBuildCommand] = useState(railpack?.buildCommand ?? "");
  const [staticRoot, setStaticRoot] = useState(railpack?.staticRoot ?? "");
  const [spa, setSpa] = useState(railpack?.spa ?? false);

  const save = useMutation({
    mutationFn: async () => {
      const current = await orpc.project.manifest.get.call({
        id: resource.projectId as never,
      });
      const base = current.manifest;
      if (!base) {
        throw new Error("No manifest saved yet — can't update build settings.");
      }
      const svc = base.services[resource.name];
      if (!svc || svc.source !== "git") {
        throw new Error("Build settings apply only to git-sourced services.");
      }
      const trim = (value: string) => {
        const t = value.trim();
        return t.length > 0 ? t : null;
      };
      // Preserve watchPatterns (not edited here); overwrite the rest.
      const nextBuild: BuildRailpackConfig = {
        builder: "railpack",
        ...(railpack?.watchPatterns
          ? { watchPatterns: railpack.watchPatterns }
          : {}),
        packageManager: trim(packageManager),
        buildCommand: trim(buildCommand),
        staticRoot: trim(staticRoot),
        spa: spa ? true : null,
      };
      const next = {
        ...base,
        services: {
          ...base.services,
          [resource.name]: { ...svc, build: nextBuild },
        },
      };
      await orpc.project.manifest.save.call({
        projectId: resource.projectId as never,
        manifest: next,
        expectedVersion: current.version,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.project.manifest.diff.queryKey({
            input: { projectId: resource.projectId as never },
          }),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.project.manifest.get.queryKey({
            input: { id: resource.projectId as never },
          }),
        }),
        queryClient.invalidateQueries({ queryKey: ["resource"] }),
      ]);
      toast.success("Build settings saved", {
        description: "Deploy to rebuild with these settings.",
      });
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Failed to save build settings",
      ),
  });

  // Only git-sourced railpack services have these knobs.
  if (!railpack) return null;

  const dirty =
    (railpack.packageManager ?? "") !== packageManager ||
    (railpack.buildCommand ?? "") !== buildCommand ||
    (railpack.staticRoot ?? "") !== staticRoot ||
    (railpack.spa ?? false) !== spa;

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

      <BuildFieldRow
        label="Build command"
        hint="Overrides the detected build step."
      >
        <Input
          value={buildCommand}
          onChange={(e) => setBuildCommand(e.target.value)}
          placeholder="auto"
          className="h-8 font-mono text-[12.5px]"
          disabled={save.isPending}
        />
      </BuildFieldRow>

      <BuildFieldRow
        label="Static root"
        hint="Built-assets dir for static sites (default: dist)."
      >
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
        <Switch
          checked={spa}
          disabled={save.isPending}
          onCheckedChange={(next) => setSpa(next)}
        />
      </div>

      <div className="flex justify-end px-3 py-2.5">
        <Button
          type="button"
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </SettingsCard>
  );
}

function BuildFieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 border-b border-border/40 px-3 py-2.5">
      <div className="flex w-40 shrink-0 flex-col pt-1">
        <span className="text-[12px] text-foreground">{label}</span>
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
