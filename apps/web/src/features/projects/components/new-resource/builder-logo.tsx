/**
 * Real brand marks for the builders in the New-resource wizard's Builder
 * step. Each tile renders the project's actual SVG logo (or, where the
 * project doesn't publish one — Railpack uses 📦 — we substitute the
 * Railway brand mark, since Railpack is by Railway). Same pattern as
 * the Postgres / Redis / Docker SVGs already in svgs/.
 *
 * Tile sizing matches the old letter-tile container so the card
 * geometry doesn't shift.
 */

import { Buildpacks } from "@/shared/components/ui/svgs/buildpacks";
import { Docker } from "@/shared/components/ui/svgs/docker";
import { Html5 } from "@/shared/components/ui/svgs/html5";
import { Railway } from "@/shared/components/ui/svgs/railway";
import { cn } from "@/shared/lib/utils";

type BuilderId = "railpack" | "dockerfile" | "compose" | "buildpack" | "static";

const TILE = "grid size-[26px] place-items-center rounded-[5px] border bg-muted/40";

export function BuilderLogo({ id }: { id: string }) {
  if (id === "railpack") {
    return (
      <div className={cn(TILE, "text-foreground")}>
        <Railway className="size-[14px]" />
      </div>
    );
  }
  if (id === "dockerfile" || id === "compose") {
    return (
      <div className={TILE}>
        <Docker className="size-[14px]" />
      </div>
    );
  }
  if (id === "buildpack") {
    return (
      <div className={TILE}>
        <Buildpacks className="size-[18px]" />
      </div>
    );
  }
  if (id === "static") {
    return (
      <div className={TILE}>
        <Html5 className="size-[13px]" />
      </div>
    );
  }
  return (
    <div className={cn(TILE, "text-muted-foreground")}>
      <span className="font-mono text-[12px] font-bold">?</span>
    </div>
  );
}

export type { BuilderId };
