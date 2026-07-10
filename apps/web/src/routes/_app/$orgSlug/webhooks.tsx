/**
 * Webhooks page — Outbound (signed event POSTs + recent-deliveries log) and
 * Inbound (unique trigger URLs) behind line tabs, backed by the
 * `outboundCollection` / `inboundCollection` (oRPC `webhooks` router).
 * Outbound webhooks fire on the same platform-event catalog notifications
 * route; inbound endpoints verify HMAC + IP allowlist before acting.
 */
import { useState } from "react";

import { Download01Icon, PlusSignIcon, Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import {
  inboundCollection,
  outboundCollection,
} from "@/features/webhooks/data/webhooks";
import { DeliveriesTable } from "@/features/webhooks/deliveries-table";
import { InboundCard } from "@/features/webhooks/inbound-card";
import { InboundDialog } from "@/features/webhooks/inbound-dialog";
import { OutboundCard } from "@/features/webhooks/outbound-card";
import {
  OutboundDialog,
  type OutboundFormValues,
} from "@/features/webhooks/outbound-dialog";
import {
  type InboundEndpoint,
  type OutboundWebhook,
} from "@/features/webhooks/shared";
import { Page, PageHeader } from "@/shared/components/page";
import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";

export const Route = createFileRoute("/_app/$orgSlug/webhooks")({
  staticData: { crumb: "Webhooks" },
  component: RouteComponent,
});

function CardSkeletons() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 2 }).map((_, i) => (
        <Skeleton key={i} className="h-32 w-full rounded-md" />
      ))}
    </div>
  );
}

function RouteComponent() {
  const [outboundDialogOpen, setOutboundDialogOpen] = useState(false);
  const [editingOutbound, setEditingOutbound] = useState<OutboundWebhook | null>(null);
  const [inboundDialogOpen, setInboundDialogOpen] = useState(false);
  const [editingInbound, setEditingInbound] = useState<InboundEndpoint | null>(null);

  const { data: outbound, isLoading: outboundLoading } = useLiveQuery((q) =>
    q.from({ w: outboundCollection }),
  );
  const { data: inbound, isLoading: inboundLoading } = useLiveQuery((q) =>
    q.from({ e: inboundCollection }),
  );

  const openCreateOutbound = () => {
    setEditingOutbound(null);
    setOutboundDialogOpen(true);
  };
  const openEditOutbound = (w: OutboundWebhook) => {
    setEditingOutbound(w);
    setOutboundDialogOpen(true);
  };
  const openCreateInbound = () => {
    setEditingInbound(null);
    setInboundDialogOpen(true);
  };
  const openEditInbound = (e: InboundEndpoint) => {
    setEditingInbound(e);
    setInboundDialogOpen(true);
  };

  const handleOutboundSubmit = (values: OutboundFormValues) => {
    const tx = editingOutbound
      ? outboundCollection.update(editingOutbound.id, (draft) => {
          draft.url = values.url;
          draft.events = values.events as OutboundWebhook["events"];
        })
      : outboundCollection.insert({
          // Optimistic placeholder — the real row (server id, minted secret)
          // replaces this on the post-create refetch.
          id: crypto.randomUUID() as OutboundWebhook["id"],
          url: values.url,
          events: values.events as OutboundWebhook["events"],
          status: "active",
          totalDeliveries: 0,
          successRate: null,
          lastDelivery: null,
          failed24h: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

    setOutboundDialogOpen(false);
    tx.isPersisted.promise
      .then(() => toast.success(editingOutbound ? "Webhook updated" : "Webhook added"))
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Couldn't save webhook"),
      );
  };

  return (
    <Page width="narrow" className="max-w-5xl">
      <PageHeader
        title="Webhooks"
        description="Outbound webhooks fire on platform events. Inbound endpoints receive triggers from your CI or external systems."
      />

      <Tabs defaultValue="outbound" className="gap-4">
        <div className="border-b">
          <TabsList variant="line" className="h-auto bg-transparent p-0">
            <TabsTrigger value="outbound" className="gap-1.5 px-3 py-2">
              <HugeiconsIcon icon={Upload01Icon} strokeWidth={2} className="size-3.5" />
              Outbound · {outbound.length}
            </TabsTrigger>
            <TabsTrigger value="inbound" className="gap-1.5 px-3 py-2">
              <HugeiconsIcon icon={Download01Icon} strokeWidth={2} className="size-3.5" />
              Inbound · {inbound.length}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="outbound" className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <p className="text-[11px] text-muted-foreground">
              Payloads are HMAC-SHA256 signed; failed deliveries retry with exponential backoff.
            </p>
            <div className="flex-1" />
            <Button size="sm" onClick={openCreateOutbound}>
              <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
              Add outbound webhook
            </Button>
          </div>

          {outboundLoading ? (
            <CardSkeletons />
          ) : outbound.length > 0 ? (
            <div className="flex flex-col gap-3">
              {outbound.map((w) => (
                <OutboundCard key={w.id} webhook={w} onEdit={openEditOutbound} />
              ))}
            </div>
          ) : (
            <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
              <EmptyHeader>
                <HugeiconsIcon
                  icon={Upload01Icon}
                  strokeWidth={1.5}
                  className="size-10 text-muted-foreground/50"
                />
                <EmptyTitle>No outbound webhooks yet</EmptyTitle>
                <EmptyDescription>
                  Add a target URL and pick the platform events it should receive — deploys,
                  builds, health, backups, certs.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          <DeliveriesTable />
        </TabsContent>

        <TabsContent value="inbound" className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <p className="text-[11px] text-muted-foreground">
              Each endpoint exposes a unique URL. Requests are verified against the HMAC secret and
              source-IP allowlist before triggering the configured action.
            </p>
            <div className="flex-1" />
            <Button size="sm" onClick={openCreateInbound}>
              <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
              Create endpoint
            </Button>
          </div>

          {inboundLoading ? (
            <CardSkeletons />
          ) : inbound.length > 0 ? (
            <div className="flex flex-col gap-3">
              {inbound.map((e) => (
                <InboundCard key={e.id} endpoint={e} onEdit={openEditInbound} />
              ))}
            </div>
          ) : (
            <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
              <EmptyHeader>
                <HugeiconsIcon
                  icon={Download01Icon}
                  strokeWidth={1.5}
                  className="size-10 text-muted-foreground/50"
                />
                <EmptyTitle>No inbound endpoints yet</EmptyTitle>
                <EmptyDescription>
                  Create an endpoint to redeploy a service from CI, GitHub, or any system that can
                  send a signed POST.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </TabsContent>
      </Tabs>

      <OutboundDialog
        open={outboundDialogOpen}
        onOpenChange={setOutboundDialogOpen}
        editing={editingOutbound}
        onSubmit={handleOutboundSubmit}
      />
      <InboundDialog
        open={inboundDialogOpen}
        onOpenChange={setInboundDialogOpen}
        editing={editingInbound}
      />
    </Page>
  );
}
