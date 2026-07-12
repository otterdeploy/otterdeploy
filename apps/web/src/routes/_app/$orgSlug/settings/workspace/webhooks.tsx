/**
 * Webhooks page — Outbound (signed event POSTs + recent-deliveries log) and
 * Inbound (unique trigger URLs) behind line tabs, backed by the
 * `outboundCollection` / `inboundCollection` (oRPC `webhooks` router).
 * Outbound webhooks fire on the same platform-event catalog notifications
 * route; inbound endpoints verify HMAC + IP allowlist before acting.
 */
import { useState } from "react";

import { Download01Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import {
  inboundCollection,
  outboundCollection,
} from "@/features/webhooks/data/webhooks";
import { InboundDialog } from "@/features/webhooks/inbound-dialog";
import {
  OutboundDialog,
  type OutboundFormValues,
} from "@/features/webhooks/outbound-dialog";
import {
  type InboundEndpoint,
  type OutboundWebhook,
} from "@/features/webhooks/shared";
import { Page, PageHeader } from "@/shared/components/page";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";

import { InboundTab, OutboundTab } from "../../-components/webhooks-tabs";

export const Route = createFileRoute("/_app/$orgSlug/settings/workspace/webhooks")({
  staticData: { crumb: "Webhooks" },
  component: RouteComponent,
});

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
          <OutboundTab
            outbound={outbound}
            loading={outboundLoading}
            onCreate={openCreateOutbound}
            onEdit={openEditOutbound}
          />
        </TabsContent>

        <TabsContent value="inbound" className="flex flex-col gap-5">
          <InboundTab
            inbound={inbound}
            loading={inboundLoading}
            onCreate={openCreateInbound}
            onEdit={openEditInbound}
          />
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
