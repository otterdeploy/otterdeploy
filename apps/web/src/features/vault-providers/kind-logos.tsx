/**
 * Brand mark per provider kind, on a fixed dark tile in both themes: the
 * Vault and Infisical marks are brand yellow and have no contrast on light
 * surfaces. Shared by the provider rows and the kind picker so the two
 * surfaces can't drift.
 */

import type { ComponentType, SVGProps } from "react";

import { Doppler } from "@/shared/components/ui/svgs/doppler";
import { Infisical } from "@/shared/components/ui/svgs/infisical";
import { Vault } from "@/shared/components/ui/svgs/vault";
import { cn } from "@/shared/lib/utils";

import type { VaultProviderKind } from "./data/vault-providers";

const KIND_LOGOS: Record<VaultProviderKind, ComponentType<SVGProps<SVGSVGElement>>> = {
  hashicorp: Vault,
  infisical: Infisical,
  doppler: Doppler,
};

export function ProviderMark({
  kind,
  className,
  logoClassName,
}: {
  kind: VaultProviderKind;
  /** Tile size/shape overrides: defaults to a size-9 rounded tile. */
  className?: string;
  logoClassName?: string;
}) {
  const Logo = KIND_LOGOS[kind];
  return (
    <div
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-md bg-zinc-950 ring-1 ring-foreground/10",
        className,
      )}
    >
      <Logo className={cn("size-4.5", logoClassName)} />
    </div>
  );
}
