/**
 * Notifications page — channel list + event subscription matrix, backed by the
 * `channelsCollection` / `subscriptionsCollection` (oRPC `notifications`
 * router). Channels and the subscription grid are live collection state; the
 * matrix toggles optimistically by inserting/deleting subscription rows.
 */
import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Notification03Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { toast } from "sonner";

import { ChannelCard } from "@/features/notifications/channel-card";
import {
  ChannelDialog,
  type ChannelFormValues,
} from "@/features/notifications/channel-dialog";
import {
  channelsCollection,
  subscriptionsCollection,
} from "@/features/notifications/data/notifications";
import { type Channel } from "@/features/notifications/shared";
import { SubscriptionMatrix } from "@/features/notifications/subscription-matrix";
import { Page, PageHeader } from "@/shared/components/page";
import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";

export const Route = createFileRoute("/_app/$orgSlug/notifications")({
  staticData: { crumb: "Notifications" },
  component: RouteComponent,
});

function RouteComponent() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Channel | null>(null);

  const { data: channels } = useLiveQuery((q) =>
    q.from({ c: channelsCollection }),
  );
  const { data: subscriptions } = useLiveQuery((q) =>
    q.from({ s: subscriptionsCollection }),
  );

  // channelId → set of subscribed event ids, for the matrix grid.
  const subs = useMemo(() => {
    const out: Record<string, Set<string>> = {};
    for (const s of subscriptions) {
      (out[s.channelId] ??= new Set()).add(s.eventId);
    }
    return out;
  }, [subscriptions]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (c: Channel) => {
    setEditing(c);
    setDialogOpen(true);
  };

  const handleSubmit = (values: ChannelFormValues) => {
    const tx = editing
      ? channelsCollection.update(
          editing.id,
          { metadata: { secret: values.secret } },
          (draft) => {
            draft.name = values.name;
            draft.config = values.config;
            if (values.target.trim()) draft.target = values.target;
          },
        )
      : channelsCollection.insert(
          {
            // Optimistic placeholder — the real row (server id, masked target,
            // computed stats) replaces this on the post-create refetch.
            id: crypto.randomUUID() as Channel["id"],
            kind: values.kind,
            name: values.name,
            target: values.target,
            transport: "",
            config: values.config,
            status: "active",
            events7d: 0,
            lastDelivery: null,
            failed24h: 0,
            note: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          { metadata: { secret: values.secret } },
        );

    setDialogOpen(false);
    tx.isPersisted.promise
      .then(() => toast.success(editing ? "Channel updated" : "Channel added"))
      .catch((err: unknown) =>
        toast.error(
          err instanceof Error ? err.message : "Couldn't save channel",
        ),
      );
  };

  const toggleSub = (channelId: string, eventId: string, enabled: boolean) => {
    const tx = enabled
      ? subscriptionsCollection.insert({
          channelId: channelId as Channel["id"],
          eventId: eventId as never,
        })
      : subscriptionsCollection.delete(`${channelId}:${eventId}`);
    tx.isPersisted.promise.catch((err: unknown) =>
      toast.error(
        err instanceof Error ? err.message : "Couldn't update routing",
      ),
    );
  };

  return (
    <Page width="narrow">
      <PageHeader
        title="Notifications"
        description="Routes deploy, build, health, and security events to your channels."
        actions={
          <Button size="sm" onClick={openCreate}>
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
            Add channel
          </Button>
        }
      />

      {channels.length > 0 ? (
        <div className="flex flex-col gap-3">
          {channels.map((c) => (
            <ChannelCard key={c.id} channel={c} onEdit={openEdit} />
          ))}
        </div>
      ) : (
        <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
          <EmptyHeader>
            <HugeiconsIcon
              icon={Notification03Icon}
              strokeWidth={1.5}
              className="size-10 text-muted-foreground/50"
            />
            <EmptyTitle>No channels yet</EmptyTitle>
            <EmptyDescription>
              Add a Slack, Discord, email, webhook, Telegram, or PagerDuty
              channel to start routing events.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {channels.length > 0 && (
        <SubscriptionMatrix
          channels={channels}
          subs={subs}
          onToggle={toggleSub}
        />
      )}

      <ChannelDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSubmit={handleSubmit}
      />
    </Page>
  );
}
