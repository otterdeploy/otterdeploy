/**
 * The strip under a key row when its public key is shown: the key on one
 * line (middle-truncated, expandable to the full key on one scrollable line,
 * never wrapped mid-token) with Copy beside it, then short facts: what
 * otterdeploy uses the key for and whether it can sign in with it. The row
 * above already shows the fingerprint and the servers, so neither repeats.
 */

import { useState } from "react";

import {
  ArrowDown01Icon,
  Copy01Icon,
  SquareLock02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { copyToClipboard } from "@/shared/lib/clipboard";
import { cn } from "@/shared/lib/utils";

import type { SshKey } from "./data/ssh-keys";

import { publicKeyParts } from "./data/ssh-keys";

export function KeyDetail({ sshKey }: { sshKey: SshKey }) {
  const { t } = useTranslation();
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);
  const parts = publicKeyParts(sshKey.publicKey);

  const copy = () => {
    void copyToClipboard(sshKey.publicKey).then((ok) => {
      if (!ok) {
        toast.error("Couldn't copy the public key");
        return;
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div className="flex max-w-[760px] flex-col gap-2.5 px-4 pb-3.5 xl:pl-[60px]">
      <div className="flex h-8 min-w-0 items-center gap-1 rounded-lg bg-muted pr-1 pl-2.5 ring-1 ring-foreground/10">
        <code
          aria-label={t("sshKeys.publicKey")}
          title={full ? undefined : sshKey.publicKey}
          tabIndex={full ? 0 : -1}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 font-mono text-xs whitespace-nowrap",
            full
              ? "[scrollbar-width:thin] overflow-x-auto rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
              : "overflow-hidden",
          )}
        >
          {full ? (
            <span className="whitespace-pre select-all">{sshKey.publicKey}</span>
          ) : (
            <>
              <span className="shrink-0 text-muted-foreground">{parts.type}</span>
              <span className="shrink-0">{parts.blob}</span>
              {parts.comment ? (
                <span className="min-w-0 truncate text-muted-foreground">{parts.comment}</span>
              ) : null}
            </>
          )}
        </code>
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted-foreground"
          aria-expanded={full}
          aria-label={full ? "Collapse public key" : "Show full public key"}
          onClick={() => setFull((v) => !v)}
        >
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={2}
            className={cn(
              "transition-transform duration-200 motion-reduce:transition-none",
              full && "rotate-180",
            )}
          />
        </Button>
        <Button variant="outline" size="xs" className="shrink-0" onClick={copy}>
          <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} strokeWidth={2} />
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <dl className="grid grid-cols-[84px_1fr] items-center gap-x-3 gap-y-1.5 text-[12.5px]">
        {sshKey.usedBy.length > 0 ? (
          <>
            <dt className="text-muted-foreground">Used for</dt>
            <dd>edge config push · firewall repair</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Sign-in</dt>
        <dd className="flex items-center gap-1.5">
          {sshKey.hasPrivateKey ? (
            "Private half encrypted on the control plane"
          ) : (
            <>
              <HugeiconsIcon icon={SquareLock02Icon} strokeWidth={2} className="size-3" />
              Public half only: can't sign in
            </>
          )}
        </dd>
      </dl>
    </div>
  );
}
