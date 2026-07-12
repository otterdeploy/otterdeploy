/**
 * One inbound trigger endpoint: name + status, what a verified request does,
 * the unique endpoint URL (copyable), the HMAC secret behind an eye-reveal,
 * allowed method + source IPs, and the last invocation time.
 *
 * Delete rides `inboundCollection` (optimistic); pause is a direct call
 * (server-flipped status) followed by a list refetch.
 */
import { useState } from "react";

import { Copy01Icon, Delete01Icon, PencilEdit01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { relativeTime } from "@/features/notifications/shared";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { copyToClipboard } from "@/shared/lib/clipboard";
import { client } from "@/shared/server/orpc";

import { inboundCollection, invalidateInbound } from "./data/webhooks";
import { SecretReveal } from "./secret-reveal";
import { STATUS_META, inboundUrl, type InboundEndpoint } from "./shared";

function actionDescription(e: InboundEndpoint): string {
  if (e.action !== "redeploy") return "Records invocations only";
  if (!e.resourceName) return "Redeploy — no service bound";
  return `Triggers redeploy of ${e.resourceName}${e.projectSlug ? ` · ${e.projectSlug}` : ""}`;
}

export function InboundCard({
  endpoint,
  onEdit,
}: {
  endpoint: InboundEndpoint;
  onEdit: (e: InboundEndpoint) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = inboundUrl(endpoint.token);
  const { label, dot } = STATUS_META[endpoint.status];

  const copyUrl = () => {
    void copyToClipboard(url).then((ok) => {
      if (!ok) {
        toast.error("Couldn't copy URL");
        return;
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const pause = () => {
    setBusy(true);
    client.webhooks.inbound
      .pause({ id: endpoint.id })
      .then(() => invalidateInbound())
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Couldn't update endpoint"),
      )
      .finally(() => setBusy(false));
  };

  const remove = () => {
    setBusy(true);
    inboundCollection
      .delete(endpoint.id)
      .isPersisted.promise.then(() => toast.success("Endpoint removed"))
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Couldn't remove endpoint"),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="rounded-md border bg-card p-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold">{endpoint.name}</span>
            <Badge variant="outline" className="gap-1.5 font-normal">
              <span className={`size-1.5 rounded-full ${dot}`} />
              {label}
            </Badge>
          </div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            {actionDescription(endpoint)}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={() => onEdit(endpoint)}>
            <HugeiconsIcon icon={PencilEdit01Icon} strokeWidth={2} className="size-3.5" />
            Edit
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={pause}>
            {endpoint.status === "paused" ? "Resume" : "Pause"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={remove}
            aria-label="Delete endpoint"
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <HugeiconsIcon icon={Delete01Icon} strokeWidth={2} className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        <div>
          <div className="mb-1.5 text-[10px] tracking-wider text-muted-foreground uppercase">
            Endpoint URL
          </div>
          <div className="flex items-center gap-1 rounded-md border bg-muted/40 py-1 pr-1 pl-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{url}</span>
            <Button size="sm" variant="ghost" className="h-6 gap-1 px-2" onClick={copyUrl}>
              <HugeiconsIcon
                icon={copied ? Tick02Icon : Copy01Icon}
                strokeWidth={2}
                className="size-3.5"
              />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <div className="mb-1.5 text-[10px] tracking-wider text-muted-foreground uppercase">
              HMAC secret
            </div>
            <SecretReveal
              label="HMAC secret"
              fetchSecret={() =>
                client.webhooks.inbound.reveal({ id: endpoint.id }).then((r) => r.secret)
              }
            />
          </div>
          <div>
            <div className="mb-1.5 text-[10px] tracking-wider text-muted-foreground uppercase">
              Allowed methods
            </div>
            <Badge variant="outline" className="font-mono text-[10px]">
              POST
            </Badge>
          </div>
          <div>
            <div className="mb-1.5 text-[10px] tracking-wider text-muted-foreground uppercase">
              Allowed source IPs
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">
              {endpoint.ipAllowlist.length > 0 ? endpoint.ipAllowlist.join(", ") : "any"}
            </span>
          </div>
        </div>

        <div className="text-[11px] text-muted-foreground">
          Last invocation{" "}
          <span className="font-mono text-foreground">{relativeTime(endpoint.lastInvokedAt)}</span>
        </div>
      </div>
    </div>
  );
}
