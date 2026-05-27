/**
 * Optional nixpacks overrides — build / start / install commands and
 * extra packages. Empty fields mean "use nixpacks defaults".
 *
 * Packages are entered as a comma-separated list; the parent maps them
 * into the wire-shape array in `buildNixpacksPatch`.
 */

import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

interface NixpacksSectionProps {
  buildCmd: string;
  startCmd: string;
  installCmd: string;
  packages: string;
  aptPackages: string;
  onChange: (
    key: "buildCmd" | "startCmd" | "installCmd" | "packages" | "aptPackages",
    value: string,
  ) => void;
}

export function NixpacksSection(props: NixpacksSectionProps) {
  return (
    <section className="rounded-md border bg-card p-5">
      <header className="mb-3">
        <h2 className="text-[14px] font-semibold">Nixpacks (optional)</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Overrides for the auto-detected build plan. Leave blank to let
          nixpacks decide.
        </p>
      </header>

      <div className="grid gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nix-install">Install command</Label>
          <Input
            id="nix-install"
            value={props.installCmd}
            onChange={(e) => props.onChange("installCmd", e.target.value)}
            placeholder="bun install --frozen-lockfile"
            className="font-mono text-[12px]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nix-build">Build command</Label>
          <Input
            id="nix-build"
            value={props.buildCmd}
            onChange={(e) => props.onChange("buildCmd", e.target.value)}
            placeholder="bun run build"
            className="font-mono text-[12px]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nix-start">Start command</Label>
          <Input
            id="nix-start"
            value={props.startCmd}
            onChange={(e) => props.onChange("startCmd", e.target.value)}
            placeholder="bun run start"
            className="font-mono text-[12px]"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nix-pkgs">Nix packages</Label>
            <Input
              id="nix-pkgs"
              value={props.packages}
              onChange={(e) => props.onChange("packages", e.target.value)}
              placeholder="ffmpeg, imagemagick"
              className="font-mono text-[12px]"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nix-apt">Apt packages</Label>
            <Input
              id="nix-apt"
              value={props.aptPackages}
              onChange={(e) => props.onChange("aptPackages", e.target.value)}
              placeholder="libpq-dev, build-essential"
              className="font-mono text-[12px]"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
