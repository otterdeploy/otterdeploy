/**
 * The face beside a deploy: the person's avatar (initials when there is no
 * picture), or a system mark when nobody triggered it by hand. A system mark,
 * not a person's face, so an API key or automation never reads as a teammate.
 */

import type { DeployActor } from "@otterdeploy/shared/deploy-status";

import { FlashIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Avatar, AvatarFallback, AvatarImage } from "@/shared/components/ui/avatar";
import { cn } from "@/shared/lib/utils";

function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0]?.[0] ?? "";
  const second = words.length > 1 ? (words.at(-1)?.[0] ?? "") : (words[0]?.[1] ?? "");
  return `${first}${second}`.toUpperCase();
}

export function ActorAvatar({
  actor,
  className,
}: {
  actor: DeployActor;
  /** Size utility; defaults to 24px. */
  className?: string;
}) {
  if (actor.kind === "automatic") {
    return (
      <span
        aria-hidden
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground ring-1 ring-foreground/10",
          className,
        )}
      >
        <HugeiconsIcon icon={FlashIcon} strokeWidth={2} className="size-3" />
      </span>
    );
  }
  return (
    <Avatar size="sm" className={cn("size-6", className)} aria-hidden>
      {actor.image ? <AvatarImage src={actor.image} alt="" /> : null}
      <AvatarFallback className="text-[10px] font-medium">{initials(actor.name)}</AvatarFallback>
    </Avatar>
  );
}
