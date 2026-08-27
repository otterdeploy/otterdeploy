/**
 * The action cluster for the selected channel: status pill, Test, Deliveries,
 * and an overflow menu holding edit / pause / delete.
 *
 * It used to be five equal-weight outline buttons on EVERY channel card, so a
 * page with three channels showed fifteen competing outlines and no primary
 * anything. There is one cluster now, for the selected channel, with a real
 * hierarchy: Test keeps an outline because it is what you press immediately
 * after adding a channel, Deliveries is ghost, and the three destructive-or-
 * rare actions fold into a menu.
 *
 * Test and pause stay direct `client.notifications.channels.*` calls rather
 * than collection mutations: `test` has no row to mutate, and `pause` flips a
 * server-computed status (active ⇆ paused, distinct from the derived
 * `warn`/`disconnected` states) that isn't a plain settable field. Both refetch
 * the list on success. Delete rides `channelsCollection` (optimistic).
 *
 * Delete is confirmed. It was a one-click ghost button before; moving it into a
 * menu makes it easier to hit without looking, and a channel takes its whole
 * event routing with it when it goes.
 */

import { useState } from "react";

import {
  Clock01Icon,
  Delete01Icon,
  FlashIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PencilEdit01Icon,
  PlayIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";
import { client, orpc, queryClient } from "@/shared/server/orpc";

import { channelsCollection } from "./data/notifications";
import { type Channel, type ChannelStatus } from "./shared";

export function StatusPill({ status }: { status: ChannelStatus }) {
  const meta: Record<ChannelStatus, { label: string; dot: string }> = {
    active: { label: "active", dot: "bg-emerald-500" },
    warn: { label: "degraded", dot: "bg-amber-500" },
    paused: { label: "paused", dot: "bg-muted-foreground" },
    disconnected: { label: "disconnected", dot: "bg-muted-foreground" },
  };
  const { label, dot } = meta[status];
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className={cn("size-1.5 rounded-full", dot)} />
      {label}
    </Badge>
  );
}

export function ChannelActions({
  channel,
  onEdit,
  onViewDeliveries,
}: {
  channel: Channel;
  onEdit: (c: Channel) => void;
  onViewDeliveries: (c: Channel) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const paused = channel.status === "paused";

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
        toast.error(err instanceof Error ? err.message : "Couldn't update channel"),
      )
      .finally(() => setBusy(false));
  };

  const remove = () => {
    setConfirmDelete(false);
    setBusy(true);
    channelsCollection
      .delete(channel.id)
      .isPersisted.promise.then(() => toast.success(t("notifications.channelRemoved")))
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Couldn't remove channel"),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Button size="sm" variant="outline" disabled={busy} onClick={test}>
        <HugeiconsIcon icon={FlashIcon} strokeWidth={2} className="size-3.5" />
        Test
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground"
        onClick={() => onViewDeliveries(channel)}
      >
        <HugeiconsIcon icon={Clock01Icon} strokeWidth={2} className="size-3.5" />
        Deliveries
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground"
              aria-label={t("common.more")}
            />
          }
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => onEdit(channel)}>
            <HugeiconsIcon icon={PencilEdit01Icon} strokeWidth={2} />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy} onClick={pause}>
            <HugeiconsIcon icon={paused ? PlayIcon : PauseIcon} strokeWidth={2} />
            {paused ? "Resume" : "Pause"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            <HugeiconsIcon icon={Delete01Icon} strokeWidth={2} />
            {t("notifications.deleteChannel")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("notifications.deleteConfirmTitle", { channel: channel.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("notifications.deleteConfirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>
              {t("notifications.deleteChannel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
