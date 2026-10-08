/**
 * "Build with" picker on the Source step: Dockerfile or Railpack, defaulted by
 * `useSourceDefaults` from what `git.inspectRepo` found at the root directory
 * (build-defaults.ts). It sits next to the service type because the two decide
 * together what gets built: a static site always builds with railpack, so for
 * that type this says so instead of offering a choice that would be ignored.
 */

import { cn } from "@/shared/lib/utils";

import type { RepoDetection, ServiceBuilder } from "../build-defaults";

import { resolvedBuilder } from "../build-defaults";

const OPTIONS: Array<[ServiceBuilder, string]> = [
  ["dockerfile", "Dockerfile"],
  ["railpack", "Railpack"],
];

function builderNote(builder: ServiceBuilder, detection: RepoDetection, root: string): string {
  const where = root ? `/${root}` : "the repo root";
  const file = detection.dockerfile ? `/${detection.dockerfile.path}` : null;
  if (builder === "dockerfile") {
    return file
      ? `Builds the image from ${file}, the way the repo itself builds it.`
      : `No Dockerfile at ${where}: this build would fail. Pick Railpack, or add one.`;
  }
  return file
    ? `Railpack detects the stack and builds it; ${file} is not used.`
    : `No Dockerfile at ${where}, so Railpack detects the stack and builds it.`;
}

export function BuildMethodSelector({
  kindId,
  builderId,
  detection,
  root,
  onChange,
}: {
  kindId: string;
  builderId: string;
  detection: RepoDetection;
  root: string;
  onChange: (builderId: ServiceBuilder) => void;
}) {
  if (kindId === "static") {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium">Build with</span>
        <p className="text-[11px] text-muted-foreground">
          Static sites build with Railpack and are served by Caddy.
          {detection.dockerfile
            ? ` /${detection.dockerfile.path} is not used; pick Web app to build with it.`
            : ""}
        </p>
      </div>
    );
  }

  const active = resolvedBuilder(builderId, detection);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium">Build with</span>
      <div className="inline-flex w-fit rounded-md border p-0.5" role="radiogroup">
        {OPTIONS.map(([id, label]) => {
          const isActive = id === active;
          // A Dockerfile build with no Dockerfile only fails later, at build
          // time. Not offering it is the honest version of that error.
          const unavailable = id === "dockerfile" && !detection.dockerfile && !isActive;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={isActive}
              disabled={unavailable}
              title={unavailable ? "No Dockerfile in this folder" : undefined}
              onClick={() => onChange(id)}
              className={cn(
                "cursor-pointer rounded-[5px] px-3 py-1 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                isActive
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">{builderNote(active, detection, root)}</p>
    </div>
  );
}
