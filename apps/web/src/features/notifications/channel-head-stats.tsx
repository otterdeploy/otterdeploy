/**
 * The delivery reading under a channel's name in the subscription matrix.
 *
 * "1 sent · 7d" on its own was a bare number with no way to ask what it
 * meant. It is now a hover target: the visible line stays terse (the column
 * is 148px), and the tooltip carries the full picture the API already
 * sends — deliveries in the window, failures in the last day, when the
 * channel last delivered, and the degraded note when there is one. A
 * channel with failures paints the count in the destructive hue so the
 * warning is legible without opening anything.
 */

import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";

import { type Channel, relativeTime } from "./shared";

export function ChannelHeadStats({ channel }: { channel: Channel }) {
  const { t } = useTranslation();
  const failing = channel.failed24h > 0;
  const statusKey = STATUS_KEY[channel.status];

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "inline-flex cursor-default items-center gap-1 text-[10px] font-normal",
              failing ? "text-destructive" : "text-muted-foreground/80",
            )}
          />
        }
      >
        <span className="font-mono">{channel.events7d}</span>
        <span className="underline decoration-dotted underline-offset-2">
          {t("notifications.sentIn7d")}
        </span>
        <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} className="size-3" />
      </TooltipTrigger>
      {/* The Popup is an inline-flex ROW on an INVERTED surface
          (bg-foreground/text-background), so everything goes in one column
          child and the muted tones are background-derived, not the page's
          muted-foreground (which would be grey-on-grey here). */}
      <TooltipContent side="bottom" align="start" className="max-w-72 items-stretch py-2">
        <div className="flex flex-col gap-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="whitespace-nowrap text-background/65">
              {t("notifications.stats.delivered7d")}
            </dt>
            <dd className="text-right font-mono tabular-nums">{channel.events7d}</dd>
            <dt className="whitespace-nowrap text-background/65">
              {t("notifications.stats.failed24h")}
            </dt>
            {/* No hue here: the tooltip surface is inverted, so a destructive
                token picked for the page would land light-red on near-white in
                dark mode. Weight carries the emphasis, and the Status row below
                names the state in words. */}
            <dd className={cn("text-right font-mono tabular-nums", failing && "font-semibold")}>
              {channel.failed24h}
            </dd>
            <dt className="whitespace-nowrap text-background/65">
              {t("notifications.stats.lastDelivery")}
            </dt>
            <dd className="text-right font-mono tabular-nums">
              {channel.lastDelivery === null
                ? t("notifications.stats.never")
                : relativeTime(channel.lastDelivery)}
            </dd>
            <dt className="whitespace-nowrap text-background/65">
              {t("notifications.stats.status")}
            </dt>
            <dd className="text-right">{t(statusKey)}</dd>
          </dl>
          {channel.note ? (
            <p className="border-t border-background/15 pt-2 text-xs text-background/80">
              {channel.note}
            </p>
          ) : null}
          <p className="text-[11px] text-background/55">{t("notifications.stats.hint")}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

const STATUS_KEY = {
  active: "notifications.stats.statusActive",
  paused: "notifications.stats.statusPaused",
  disconnected: "notifications.stats.statusDisconnected",
  warn: "notifications.stats.statusWarn",
} as const satisfies Record<Channel["status"], string>;
