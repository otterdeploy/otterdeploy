/**
 * Create / edit an inbound trigger endpoint. Create is two-phase: the form
 * (name, action, target service, IP allowlist) then — because the HMAC secret
 * is returned exactly once — a success screen with the minted URL, the
 * plaintext secret, and a signed-curl snippet. Edit reuses the form half
 * (token + secret are immutable).
 *
 * Writes are direct `client.webhooks.inbound.*` calls + a list refetch (the
 * create response's one-time secret doesn't fit a collection mutation).
 */
import { useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { client, orpc } from "@/shared/server/orpc";

import { invalidateInbound } from "./data/webhooks";
import { TargetFields, type InboundAction } from "./inbound-fields";
import { SuccessScreen, type Created } from "./inbound-success";
import { inboundUrl, type InboundEndpoint } from "./shared";

interface InboundDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** null → create; an endpoint → edit that endpoint. */
  editing: InboundEndpoint | null;
}

function parseAllowlist(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Persist the endpoint — PATCH in edit mode, POST (returning the one-time
 *  secret) in create mode — and refetch the list. */
function persistEndpoint(args: {
  editing: InboundEndpoint | null;
  name: string;
  action: InboundAction;
  resourceId: string;
  ipAllowlist: string[];
  onUpdated: () => void;
  onCreated: (created: Created) => void;
}): Promise<void> {
  return args.editing
    ? client.webhooks.inbound
        .update({
          id: args.editing.id,
          name: args.name,
          action: args.action,
          resourceId: args.action === "redeploy" ? (args.resourceId as never) : null,
          ipAllowlist: args.ipAllowlist,
        })
        .then(() => {
          void invalidateInbound();
          toast.success("Endpoint updated");
          args.onUpdated();
        })
    : client.webhooks.inbound
        .create({
          name: args.name,
          action: args.action,
          ...(args.action === "redeploy" ? { resourceId: args.resourceId as never } : {}),
          ipAllowlist: args.ipAllowlist,
        })
        .then((res) => {
          void invalidateInbound();
          args.onCreated({ url: inboundUrl(res.endpoint.token), secret: res.secret });
        });
}

export function InboundDialog({ open, onOpenChange, editing }: InboundDialogProps) {
  const isEdit = editing !== null;
  const [name, setName] = useState("");
  const [action, setAction] = useState<InboundAction>("redeploy");
  const [resourceId, setResourceId] = useState<string>("");
  const [allowlistRaw, setAllowlistRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const { data: services } = useQuery({
    ...orpc.webhooks.inbound.serviceOptions.queryOptions(),
    enabled: open,
  });

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setName(editing?.name ?? "");
      setAction(editing?.action ?? "redeploy");
      setResourceId(editing?.resourceId ?? "");
      setAllowlistRaw(editing ? editing.ipAllowlist.join("\n") : "");
      setError(null);
      setCreated(null);
    }
    onOpenChange(next);
  };

  const submit = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name is required");
      return;
    }
    if (action === "redeploy" && !resourceId) {
      setError("Pick the service this endpoint redeploys");
      return;
    }
    const ipAllowlist = parseAllowlist(allowlistRaw);
    setBusy(true);
    setError(null);

    persistEndpoint({
      editing,
      name: trimmedName,
      action,
      resourceId,
      ipAllowlist,
      onUpdated: () => onOpenChange(false),
      onCreated: setCreated,
    })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Couldn't save endpoint"),
      )
      .finally(() => setBusy(false));
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        {created ? (
          <SuccessScreen created={created} onDone={() => onOpenChange(false)} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {isEdit ? "Edit inbound endpoint" : "Create inbound endpoint"}
              </DialogTitle>
              <DialogDescription>
                {isEdit ? (
                  <>The endpoint URL and HMAC secret are fixed for the endpoint's lifetime.</>
                ) : (
                  <>
                    You'll get a unique URL and an HMAC secret. Requests must be signed with{" "}
                    <span className="font-mono text-foreground">
                      X-Otterdeploy-Signature: sha256=&lt;hmac&gt;
                    </span>{" "}
                    over the raw body.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              className="flex flex-col gap-4"
              noValidate
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="inbound-name">Name</Label>
                <Input
                  id="inbound-name"
                  className="font-mono"
                  placeholder="github-push-api"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <TargetFields
                action={action}
                onActionChange={setAction}
                resourceId={resourceId}
                onResourceIdChange={setResourceId}
                services={services}
              />

              <div className="flex flex-col gap-2">
                <Label htmlFor="inbound-allowlist">
                  IP allowlist{" "}
                  <span className="font-normal text-muted-foreground">
                    (one per line, IPv4 CIDR ok — empty allows any)
                  </span>
                </Label>
                <Textarea
                  id="inbound-allowlist"
                  className="min-h-16 font-mono text-[12px]"
                  placeholder={"140.82.112.0/20\n192.30.252.0/22"}
                  value={allowlistRaw}
                  onChange={(e) => setAllowlistRaw(e.target.value)}
                />
              </div>

              {error && <p className="text-[11px] text-destructive">{error}</p>}

              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {isEdit ? "Save changes" : "Create endpoint"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
