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

import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
import { NativeSelect, NativeSelectOption } from "@/shared/components/ui/native-select";
import { Textarea } from "@/shared/components/ui/textarea";
import { copyToClipboard } from "@/shared/lib/clipboard";
import { client, orpc } from "@/shared/server/orpc";

import { invalidateInbound } from "./data/webhooks";
import { curlSnippet, inboundUrl, type InboundEndpoint } from "./shared";

type InboundAction = "redeploy" | "none";

interface Created {
  url: string;
  secret: string;
}

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

    const call = isEdit
      ? client.webhooks.inbound
          .update({
            id: editing.id,
            name: trimmedName,
            action,
            resourceId: action === "redeploy" ? (resourceId as never) : null,
            ipAllowlist,
          })
          .then(() => {
            void invalidateInbound();
            toast.success("Endpoint updated");
            onOpenChange(false);
          })
      : client.webhooks.inbound
          .create({
            name: trimmedName,
            action,
            ...(action === "redeploy" ? { resourceId: resourceId as never } : {}),
            ipAllowlist,
          })
          .then((res) => {
            void invalidateInbound();
            setCreated({ url: inboundUrl(res.endpoint.token), secret: res.secret });
          });

    call
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

              <div className="flex flex-col gap-2">
                <Label htmlFor="inbound-action">Target action</Label>
                <NativeSelect
                  className="w-full"
                  id="inbound-action"
                  value={action}
                  onChange={(e) => setAction(e.target.value as InboundAction)}
                >
                  <NativeSelectOption value="redeploy">Redeploy a service</NativeSelectOption>
                  <NativeSelectOption value="none">
                    Nothing — record the invocation
                  </NativeSelectOption>
                </NativeSelect>
              </div>

              {action === "redeploy" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="inbound-service">Service</Label>
                  <NativeSelect
                    className="w-full"
                    id="inbound-service"
                    value={resourceId}
                    onChange={(e) => setResourceId(e.target.value)}
                  >
                    <NativeSelectOption value="">
                      {services === undefined
                        ? "Loading services…"
                        : services.length === 0
                          ? "No services in this workspace yet"
                          : "Pick a service…"}
                    </NativeSelectOption>
                    {services?.map((s) => (
                      <NativeSelectOption key={s.resourceId} value={s.resourceId}>
                        {s.projectSlug} / {s.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              )}

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

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void copyToClipboard(value).then((ok) => {
      if (!ok) {
        toast.error("Couldn't copy");
        return;
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="flex items-center gap-1 rounded-md border bg-muted/40 py-1.5 pr-1 pl-2.5">
      <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{value}</span>
      <Button size="sm" variant="ghost" className="h-6 gap-1 px-2" onClick={copy}>
        <HugeiconsIcon
          icon={copied ? Tick02Icon : Copy01Icon}
          strokeWidth={2}
          className="size-3.5"
        />
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** Post-create screen — the only place the plaintext secret ever appears. */
function SuccessScreen({ created, onDone }: { created: Created; onDone: () => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Endpoint created</DialogTitle>
        <DialogDescription>
          Store the HMAC secret now — this is the only time it's shown in full. You can reveal it
          again later from the card, but treat this screen as the handoff.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] tracking-wider text-muted-foreground uppercase">
            Endpoint URL
          </div>
          <CopyRow value={created.url} />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] tracking-wider text-muted-foreground uppercase">
            HMAC secret
          </div>
          <div className="rounded-md border bg-muted/40 px-3 py-2.5">
            <code className="block font-mono text-[12px] leading-relaxed break-all select-all">
              {created.secret}
            </code>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] tracking-wider text-muted-foreground uppercase">
            Test with curl
          </div>
          <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed whitespace-pre text-muted-foreground">
            {curlSnippet(created.url, created.secret)}
          </pre>
        </div>
      </div>

      <DialogFooter>
        <Button onClick={onDone}>Done</Button>
      </DialogFooter>
    </>
  );
}
