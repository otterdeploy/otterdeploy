/**
 * Brand marks for the builders in the New-resource wizard's Builder step.
 * The previous tile rendered a generic monochrome stroke icon from
 * `./icons.tsx` for every builder, which made the six cards
 * (Railpack / Dockerfile / Compose / Buildpacks / Nixpacks / Static)
 * read as visually identical at a glance. These marks borrow the same
 * letter-tile pattern as `ProviderLogo` on the Variables → Sync tab so
 * the visual language stays consistent across the app.
 *
 * Dockerfile and Compose share the Docker brand SVG — both flows are
 * docker-the-tool, just different inputs. The rest are typographic
 * marks in each builder's primary brand color.
 */

import { Docker } from "@/shared/components/ui/svgs/docker";
import { cn } from "@/shared/lib/utils";

type BuilderId = "railpack" | "dockerfile" | "compose" | "buildpack" | "nixpack" | "static";

const TILE = "grid size-[26px] place-items-center rounded-[5px] font-mono text-[12px] font-bold";

export function BuilderLogo({ id }: { id: string }) {
  if (id === "railpack") {
    // Railpack — Railway-orange wordmark mark.
    return <div className={cn(TILE, "bg-[#7c3aed] text-white")}>R</div>;
  }
  if (id === "dockerfile" || id === "compose") {
    return (
      <div className={cn(TILE, "bg-[#008fe2]/12")}>
        <Docker className="size-[14px]" />
      </div>
    );
  }
  if (id === "buildpack") {
    // CNB / Buildpacks — official mark is a stylized "▲" stack.
    // We use a "B" tile in the Buildpacks blue.
    return <div className={cn(TILE, "bg-[#066da5] text-white")}>B</div>;
  }
  if (id === "nixpack") {
    // Nixpacks — leans on the Nix snowflake palette.
    return <div className={cn(TILE, "bg-[#5277c3] text-white")}>N</div>;
  }
  if (id === "static") {
    // Static site — generic web mark in the orange HTML5 tone.
    return <div className={cn(TILE, "bg-[#e44d26] text-white")}>S</div>;
  }
  // Fallback — unknown builder type. Matches the muted tile the old
  // implementation rendered so the layout doesn't shift.
  return (
    <div className={cn(TILE, "border bg-muted text-muted-foreground")}>
      ?
    </div>
  );
}

export type { BuilderId };
