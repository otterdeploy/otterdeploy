/**
 * Post-create screen for an inbound endpoint — the only place the plaintext
 * HMAC secret ever appears (the create response returns it exactly once).
 * Split out of `inbound-dialog.tsx` to keep the dialog file within budget.
 */
import { useState } from "react";

import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { copyToClipboard } from "@/shared/lib/clipboard";

import { curlSnippet } from "./shared";

export interface Created {
  url: string;
  secret: string;
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
export function SuccessScreen({ created, onDone }: { created: Created; onDone: () => void }) {
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
