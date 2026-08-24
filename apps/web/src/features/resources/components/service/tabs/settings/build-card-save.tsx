// Shared plumbing for the builder-specific build cards. Both
// `build-card-railpack.tsx` and `build-card-dockerfile.tsx` stage their next
// build config into the project manifest through this, so a build-settings
// change rides the normal pending-changes bar rather than applying instantly.

import type { BuildDockerfileConfig, BuildRailpackConfig } from "@otterdeploy/shared/build-config";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  type ServiceBuildResource,
  invalidateAfterSave,
  stageBuildConfig,
} from "./build-card-shared";

export function useSaveBuild(resource: ServiceBuildResource) {
  return useMutation({
    mutationFn: (nextBuild: BuildRailpackConfig | BuildDockerfileConfig) =>
      stageBuildConfig(resource, nextBuild),
    onSuccess: async () => {
      await invalidateAfterSave(resource.projectId);
      toast.success("Build settings saved", {
        description: "Deploy to rebuild with these settings.",
      });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to save build settings"),
  });
}

/** A labelled select styled like the card's other fields. Used for the small
 *  enum knobs (build runner, Dockerfile context) where a full Select popover
 *  would be heavier than the choice deserves. */
export function BuildSelect<T extends string>({
  value,
  onChange,
  options,
  disabled,
}: {
  value: T;
  onChange: (next: T) => void;
  options: readonly (readonly [T, string])[];
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => {
        const next = options.find(([v]) => v === e.target.value);
        if (next) onChange(next[0]);
      }}
      className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-[12.5px] ring-1 ring-foreground/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}
