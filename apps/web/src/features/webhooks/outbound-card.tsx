/**
 * One outbound webhook: target URL, effective status (failing is derived from
 * recent delivery failures server-side), delivery stats, subscribed-event
 * chips, and the HMAC signing secret behind an eye-reveal. Mirrors the
 * notifications ChannelCard idiom — `rounded-md border bg-card` shell +
 * outline action cluster.
 *
 * Delete rides `outboundCollection` (optimistic). Test and pause stay direct
 * `client.webhooks.outbound.*` calls: `test` has no row to mutate and `pause`
 * flips a server-computed status — both refetch the list on success.
 */
import { useState } from "react";

import { Delete01Icon, FlashIcon, PencilEdit01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { EVENTS } from "@/features/notifications/shared";
import { relativeTime } from "@/features/notifications/shared";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { client } from "@/shared/server/orpc";

import { invalidateOutbound, outboundCollection } from "./data/webhooks";
import { SecretReveal } from "./secret-reveal";
import { STATUS_META, type OutboundWebhook } from "./shared";

const EVENT_LABELS = new Map(EVENTS.map((e) => [e.id, e.label]));
const SHOWN_EVENTS = 6;

function StatusPill({ status }: { status: OutboundWebhook["status"] }) {
  const { label, dot } = STATUS_META[status];
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className={`size-1.5 rounded-full ${dot}`} />
      {label}
    </Badge>
  );
}

export function OutboundCard({
  webhook,
  onEdit,
}: {
  webhook: OutboundWebhook;
  onEdit: (w: OutboundWebhook) => void;
}) {
  const [busy, setBusy] = useState(false);

  const test = () => {
    setBusy(true);
    client.webhooks.outbound
      .test({ id: webhook.id })
      .then((res) => toast.success(res.message))
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Couldn't send test"),
      )
      .finally(() => setBusy(false));
  };

  const pause = () => {
    setBusy(true);
    client.webhooks.outbound
      .pause({ id: webhook.id })
      .then(() => invalidateOutbound())
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Couldn't update webhook"),
      )
      .finally(() => setBusy(false));
  };

  const remove = () => {
    setBusy(true);
    outboundCollection
      .delete(webhook.id)
      .isPersisted.promise.then(() => toast.success("Webhook removed"))
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Couldn't remove webhook"),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="rounded-md border bg-card p-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[12.5px] font-medium">{webhook.url}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusPill status={webhook.status} />
            <span className="text-[11px] text-muted-foreground">
              <span className="font-mono text-foreground">
                {webhook.totalDeliveries.toLocaleString()}
              </span>{" "}
              deliveries
              {webhook.successRate !== null && (
                <>
                  {" · "}
                  <span className="font-mono text-foreground">{webhook.successRate}%</span> success
                </>
              )}
              {" · last "}
              <span className="font-mono text-foreground">
                {relativeTime(webhook.lastDelivery)}
              </span>
            </span>
            {webhook.failed24h > 0 && (
              <span className="text-[11px] text-red-600 dark:text-red-500">
                {webhook.failed24h} failed in 24h
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="outline" disabled={busy} onClick={test}>
            <HugeiconsIcon icon={FlashIcon} strokeWidth={2} className="size-3.5" />
            Test
          </Button>
          <Button size="sm" variant="outline" onClick={() => onEdit(webhook)}>
            <HugeiconsIcon icon={PencilEdit01Icon} strokeWidth={2} className="size-3.5" />
            Edit
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={pause}>
            {webhook.status === "paused" ? "Resume" : "Pause"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={remove}
            aria-label="Delete webhook"
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <HugeiconsIcon icon={Delete01Icon} strokeWidth={2} className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[10px] tracking-wider text-muted-foreground uppercase">
            Events
          </div>
          <div className="flex flex-wrap gap-1">
            {webhook.events.slice(0, SHOWN_EVENTS).map((e) => (
              <span
                key={e}
                title={EVENT_LABELS.get(e)}
                className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
              >
                {e}
              </span>
            ))}
            {webhook.events.length > SHOWN_EVENTS && (
              <span className="px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                +{webhook.events.length - SHOWN_EVENTS}
              </span>
            )}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[10px] tracking-wider text-muted-foreground uppercase">
            HMAC secret
          </div>
          <SecretReveal
            label="HMAC secret"
            fetchSecret={() =>
              client.webhooks.outbound.reveal({ id: webhook.id }).then((r) => r.secret)
            }
          />
        </div>
      </div>

      <div className="mt-2.5 text-[11px] text-muted-foreground">
        Retry policy: exponential · max 5 attempts · 10s timeout
      </div>
    </div>
  );
}
