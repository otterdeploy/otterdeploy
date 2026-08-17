/**
 * A public host, rendered as the one-click way to go look at it.
 *
 * Every surface that shows a domain is somewhere an operator wants to open it:
 * the graph panel, the routes table, the edge-log host footer, the traffic tab.
 * The anchor was hand-rolled in each of them. Same href, same target, same
 * hover-revealed icon, so this is that shape once.
 *
 * The icon is always laid out and only fades in on hover, so a row of hosts
 * stays aligned instead of shifting by the icon's width when the pointer moves
 * across it.
 */

import { LinkSquare02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/shared/lib/utils";

export function PublicHostLink({
  host,
  className,
  iconClassName,
  title,
}: {
  /** Bare hostname, no scheme. `https://` is added here so no caller has to
   *  remember, and so a host that arrives with one can't produce
   *  `https://https://…`. */
  host: string;
  className?: string;
  iconClassName?: string;
  title?: string;
}) {
  const bare = host.replace(/^https?:\/\//, "");
  return (
    <a
      href={`https://${bare}`}
      target="_blank"
      rel="noopener noreferrer"
      title={title ?? `Open ${bare}`}
      // stopPropagation: these sit inside rows and cards that navigate on
      // click. Without it, opening the site also drives the app somewhere
      // behind the new tab.
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "group/host inline-flex min-w-0 items-center gap-1 underline-offset-2 hover:underline",
        className,
      )}
    >
      <span className="truncate">{bare}</span>
      <HugeiconsIcon
        icon={LinkSquare02Icon}
        strokeWidth={2}
        className={cn(
          "size-3 shrink-0 opacity-0 transition-opacity group-hover/host:opacity-60",
          iconClassName,
        )}
      />
    </a>
  );
}
