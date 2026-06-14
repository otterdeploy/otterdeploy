/**
 * A single notification channel row: brand mark, delivery stats, status pill,
 * and inline actions (test / edit / pause-resume / delete). Mirrors the
 * registries card idiom — `rounded-md border bg-card` shell + outline button
 * cluster. Stats + status come from the server (live delivery log).
 *
 * Delete rides `channelsCollection` (optimistic). Test and pause stay direct
 * `client.notifications.channels.*` calls: `test` has no row to mutate and
 * `pause` flips a server-computed status (active ⇆ paused) that isn't a plain
 * settable field — both refetch the list on success.
 */

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  Delete01Icon,
  FlashIcon,
  PencilEdit01Icon,
} from "@hugeicons/core-free-icons";
import { toast } from "sonner";

import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { client, orpc, queryClient } from "@/shared/server/orpc";

import { channelsCollection } from "./data/notifications";
import {
  type Channel,
  type ChannelStatus,
  KIND_META,
  relativeTime,
} from "./shared";

function StatusPill({ status }: { status: ChannelStatus }) {
  const meta: Record<ChannelStatus, { label: string; dot: string }> = {
    active: { label: "active", dot: "bg-emerald-500" },
    warn: { label: "degraded", dot: "bg-amber-500" },
    paused: { label: "paused", dot: "bg-muted-foreground" },
    disconnected: { label: "disconnected", dot: "bg-muted-foreground" },
  };
  const { label, dot } = meta[status];
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className={`size-1.5 rounded-full ${dot}`} />
      {label}
    </Badge>
  );
}

export function ChannelCard({
  channel,
  onEdit,
}: {
  channel: Channel;
  onEdit: (c: Channel) => void;
}) {
  const meta = KIND_META[channel.kind];
  const [busy, setBusy] = useState(false);

  const test = () => {
    setBusy(true);
    client.notifications.channels
      .test({ id: channel.id })
      .then((res) => toast.success(res.message))
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Couldn't send test"),
      )
      .finally(() => setBusy(false));
  };

  const pause = () => {
    setBusy(true);
    client.notifications.channels
      .pause({ id: channel.id })
      .then(() =>
        queryClient.invalidateQueries({
          queryKey: orpc.notifications.channels.list.queryKey(),
        }),
      )
      .catch((err: unknown) =>
        toast.error(
          err instanceof Error ? err.message : "Couldn't update channel",
        ),
      )
      .finally(() => setBusy(false));
  };

  const remove = () => {
    setBusy(true);
    channelsCollection
      .delete(channel.id)
      .isPersisted.promise.then(() => toast.success("Channel removed"))
      .catch((err: unknown) =>
        toast.error(
          err instanceof Error ? err.message : "Couldn't remove channel",
        ),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="rounded-md border bg-card p-3.5">
      <div className="flex items-start gap-3">
        <SvglLogo search={meta.search} fallback={meta.label} size={28} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold">{channel.name}</span>
            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {meta.label}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {channel.transport}
            </span>
            <StatusPill status={channel.status} />
          </div>

          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {channel.target}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              <span className="font-mono text-foreground">{channel.events7d}</span>{" "}
              events · 7d
            </span>
            <span>
              last delivery{" "}
              <span className="font-mono text-foreground">
                {relativeTime(channel.lastDelivery)}
              </span>
            </span>
            {channel.note && (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500">
                <HugeiconsIcon
                  icon={Alert02Icon}
                  strokeWidth={2}
                  className="size-3"
                />
                {channel.note}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 self-center">
          <Button size="sm" variant="outline" disabled={busy} onClick={test}>
            <HugeiconsIcon icon={FlashIcon} strokeWidth={2} className="size-3.5" />
            Test
          </Button>
          <Button size="sm" variant="outline" onClick={() => onEdit(channel)}>
            <HugeiconsIcon
              icon={PencilEdit01Icon}
              strokeWidth={2}
              className="size-3.5"
            />
            Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={pause}
          >
            {channel.status === "paused" ? "Resume" : "Pause"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={remove}
            aria-label="Delete channel"
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <HugeiconsIcon
              icon={Delete01Icon}
              strokeWidth={2}
              className="size-3.5"
            />
          </Button>
        </div>
      </div>
    </div>
  );
}
