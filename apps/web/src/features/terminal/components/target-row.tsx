import { CubeIcon, Database02Icon, ServerStack01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/shared/components/ui/badge";
import { CommandItem, CommandShortcut } from "@/shared/components/ui/command";
import { cn } from "@/shared/lib/utils";

import type { PickerTarget, TargetGroup } from "../data/pick-targets";

const GROUP_ICON: Record<TargetGroup, typeof ServerStack01Icon> = {
  service: CubeIcon,
  database: Database02Icon,
  server: ServerStack01Icon,
};

/**
 * cmdk scores a single `value` string, so everything searchable is flattened
 * into it: the name, the project, the replica, the container id, the image,
 * plus intent words ("shell", "ssh", "psql") an operator is likely to type.
 */
function searchValue(target: PickerTarget): string {
  return [
    target.name,
    target.qualifier ?? "",
    target.project ?? "",
    target.tag ?? "",
    target.detail,
    ...target.keywords,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * One destination. The transport lives in `detail` as a quiet trailing hint.
 * Present when you look for it, never something you have to navigate by.
 */
export function TargetRow({
  target,
  onPick,
}: {
  target: PickerTarget;
  onPick: (target: PickerTarget) => void;
}) {
  const blocked = target.unavailable !== null;

  return (
    <CommandItem
      value={searchValue(target)}
      disabled={blocked}
      onSelect={() => {
        if (!blocked) onPick(target);
      }}
      className="gap-2"
    >
      <HugeiconsIcon
        icon={GROUP_ICON[target.group]}
        strokeWidth={1.8}
        className="text-muted-foreground"
      />
      <span className="truncate font-mono text-[13px]">{target.name}</span>

      {target.qualifier && (
        <span className="shrink-0 text-[11px] text-muted-foreground">{target.qualifier}</span>
      )}

      {target.project && (
        <Badge variant="outline" className="shrink-0 font-mono text-[10px] font-normal">
          {target.project}
        </Badge>
      )}

      {target.tag && (
        <Badge variant="secondary" className="shrink-0 font-mono text-[10px] font-normal">
          {target.tag}
        </Badge>
      )}

      {blocked && (
        <span className="shrink-0 text-[11px] text-muted-foreground">{target.unavailable}</span>
      )}

      {/* Not-yet-built backends are labelled rather than hidden: the target is
          real, the path to it isn't. */}
      {target.pending && !blocked && (
        <Badge variant="outline" className="shrink-0 text-[10px] font-normal text-muted-foreground">
          not wired yet
        </Badge>
      )}

      <CommandShortcut
        className={cn("truncate font-mono text-[11px] tracking-normal", blocked && "opacity-60")}
      >
        {target.detail}
      </CommandShortcut>
    </CommandItem>
  );
}
