/**
 * Notifications: the channel grid and the selected channel's event routing,
 * backed by `channelsCollection` / `subscriptionsCollection` (oRPC
 * `notifications` router). Both are live collection state; routing toggles
 * optimistically by inserting/deleting subscription rows.
 *
 * Lives in the OPERATIONAL shell, not the settings zone. Routing events to a
 * channel is something an operator returns to (add a channel, mute a noisy
 * event, check why a delivery failed) rather than one-time configuration.
 * The same reasoning that moved git providers, registries and SSH keys out of
 * Settings → Workspace and into the sidebar.
 *
 * SHAPE: a grid of channel cards on the project-card vocabulary, then one
 * routing panel for whichever card is selected. It replaces a global
 * event×channel matrix that only worked at two-or-more channels: at one
 * channel — the common case — its single fixed-width column pinned every
 * switch to the right edge of a full-bleed page, roughly 1800px from the event
 * label it belonged to. Per-channel routing puts the control back beside its
 * label; the cross-channel comparison the matrix was for now lives in each
 * card's coverage strip, which shows every channel at once. See
 * routing-panel.tsx and channel-card.tsx for the full rationale.
 *
 * The platform-wide transport cards (email provider, Twilio, FCM) that used to
 * sit at the bottom of this page are gone: per-channel delivery credentials are
 * captured by the channel dialog itself (see channel-fields.tsx, which has the
 * Resend/SMTP picker and SMTP params), so the separate install-wide forms were
 * a second surface for the same job. System mail still resolves its transport
 * from `platform_settings` / env: see packages/email/src/transport.ts.
 */
import { useMemo, useState } from "react";
import { createId, ID_PREFIX, idSchema } from "@otterdeploy/shared/id";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { useTranslation } from "react-i18next";
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
import { DeliveryHistoryDialog } from "@/features/notifications/delivery-history-dialog";
import { RoutingPanel } from "@/features/notifications/routing-panel";
import { type Channel } from "@/features/notifications/shared";
import { EmptyCollection, IllustrationPlate } from "@/shared/components/illustrations";
import { Page, PageHeader } from "@/shared/components/page";
import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";

export const Route = createFileRoute("/_app/$orgSlug/_shell/notifications")({
  staticData: { crumb: "Notifications" },
  component: RouteComponent,
  // Warm the collection(s) on hover (intent-preload) so the page renders
  // from cache instead of spinning. Non-blocking + best-effort.
  loader: () => {
    void channelsCollection.preload();
    void subscriptionsCollection.preload();
  },
});

function toggleSub(channelId: string, eventId: string, enabled: boolean) {
  const tx = enabled
    ? subscriptionsCollection.insert({
        // The panel hands the id back as a plain string; re-brand it at the
        // boundary the same way route params are (idSchema, a real parse).
        channelId: idSchema.notificationChannel.parse(channelId),
        eventId,
      })
    : subscriptionsCollection.delete(`${channelId}:${eventId}`);
  tx.isPersisted.promise.catch((err: unknown) =>
    toast.error(err instanceof Error ? err.message : "Couldn't update routing"),
  );
}

function RouteComponent() {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Channel | null>(null);
  // Delivery-history dialog target; kept on close so the exit animation
  // doesn't collapse the content.
  const [historyChannel, setHistoryChannel] = useState<Channel | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Which card's routing is shown. Held as an id, not a channel object, and
  // RESOLVED against the live list on every render: deleting the selected
  // channel then falls through to the first remaining one on its own, with no
  // effect syncing state to state.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: channels } = useLiveQuery((q) =>
    q.from({ c: channelsCollection }),
  );
  const { data: subscriptions } = useLiveQuery((q) =>
    q.from({ s: subscriptionsCollection }),
  );

  // channelId → set of subscribed event ids, for the cards and the panel.
  const subs = useMemo(() => {
    const out: Record<string, Set<string>> = {};
    for (const s of subscriptions) {
      (out[s.channelId] ??= new Set()).add(s.eventId);
    }
    return out;
  }, [subscriptions]);

  const active = channels.find((c) => c.id === selectedId) ?? channels[0] ?? null;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (c: Channel) => {
    setEditing(c);
    setDialogOpen(true);
  };
  const openHistory = (c: Channel) => {
    setHistoryChannel(c);
    setHistoryOpen(true);
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
            // Optimistic placeholder: the real row (server id, masked target,
            // computed stats) replaces this on the post-create refetch.
            id: createId(ID_PREFIX.notificationChannel),
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

  return (
    <Page>
      <PageHeader
        title="Notifications"
        description="Routes deploy, build, health, and security events to your channels."
        actions={
          <Button size="sm" onClick={openCreate}>
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
            {t("notifications.addChannel")}
          </Button>
        }
      />

      {channels.length > 0 ? (
        <>
          {/* Same grid as the projects index, so a channel card and a project
              card are the same object at the same size on every breakpoint. */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {channels.map((c) => (
              <ChannelCard
                key={c.id}
                channel={c}
                subscribed={subs[c.id]}
                selected={c.id === active?.id}
                onSelect={(next) => setSelectedId(next.id)}
              />
            ))}
          </div>

          {active && (
            <RoutingPanel
              channel={active}
              subscribed={subs[active.id]}
              onToggle={toggleSub}
              onEdit={openEdit}
              onViewDeliveries={openHistory}
            />
          )}
        </>
      ) : (
        <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
          <EmptyHeader>
            <IllustrationPlate className="h-[140px]">
              <EmptyCollection />
            </IllustrationPlate>
            <EmptyTitle>No channels yet</EmptyTitle>
            <EmptyDescription>
              Add a Slack, Discord, email, webhook, Telegram, or PagerDuty
              channel to start routing events.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <ChannelDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSubmit={handleSubmit}
      />

      <DeliveryHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        channel={historyChannel}
      />
    </Page>
  );
}
