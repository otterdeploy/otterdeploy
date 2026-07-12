/**
 * Tab bodies for the Webhooks settings page — Outbound (signed event POSTs +
 * recent-deliveries log) and Inbound (unique trigger URLs). The route keeps
 * the dialogs and collection writes; these render the lists + empty states.
 */
import { Download01Icon, PlusSignIcon, Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { DeliveriesTable } from "@/features/webhooks/deliveries-table";
import { InboundCard } from "@/features/webhooks/inbound-card";
import { OutboundCard } from "@/features/webhooks/outbound-card";
import {
  type InboundEndpoint,
  type OutboundWebhook,
} from "@/features/webhooks/shared";
import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { Skeleton } from "@/shared/components/ui/skeleton";

function CardSkeletons() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 2 }).map((_, i) => (
        <Skeleton key={i} className="h-32 w-full rounded-md" />
      ))}
    </div>
  );
}

export function OutboundTab({
  outbound,
  loading,
  onCreate,
  onEdit,
}: {
  outbound: OutboundWebhook[];
  loading: boolean;
  onCreate: () => void;
  onEdit: (w: OutboundWebhook) => void;
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        <p className="text-[11px] text-muted-foreground">
          Payloads are HMAC-SHA256 signed; failed deliveries retry with exponential backoff.
        </p>
        <div className="flex-1" />
        <Button size="sm" onClick={onCreate}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
          Add outbound webhook
        </Button>
      </div>

      {loading ? (
        <CardSkeletons />
      ) : outbound.length > 0 ? (
        <div className="flex flex-col gap-3">
          {outbound.map((w) => (
            <OutboundCard key={w.id} webhook={w} onEdit={onEdit} />
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
    </>
  );
}

export function InboundTab({
  inbound,
  loading,
  onCreate,
  onEdit,
}: {
  inbound: InboundEndpoint[];
  loading: boolean;
  onCreate: () => void;
  onEdit: (e: InboundEndpoint) => void;
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        <p className="text-[11px] text-muted-foreground">
          Each endpoint exposes a unique URL. Requests are verified against the HMAC secret and
          source-IP allowlist before triggering the configured action.
        </p>
        <div className="flex-1" />
        <Button size="sm" onClick={onCreate}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
          Create endpoint
        </Button>
      </div>

      {loading ? (
        <CardSkeletons />
      ) : inbound.length > 0 ? (
        <div className="flex flex-col gap-3">
          {inbound.map((e) => (
            <InboundCard key={e.id} endpoint={e} onEdit={onEdit} />
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
    </>
  );
}
