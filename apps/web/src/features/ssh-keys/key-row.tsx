/**
 * One SSH key as a row of the ledger: the card's anatomy (key tile, name, type
 * badge, fingerprint with copy, used-by, timestamps, Public key / Rotate /
 * delete) refolded into columns so a screenful of keys reads at a glance.
 * "Used by" is the servers that sign in with the key, each linking to its
 * server with its live state. Public key opens the detail strip under the
 * row. Generated keys can be rotated (we hold the private half); imported keys
 * are marked "Public only" and can only be removed.
 */

import { useState } from "react";

import {
  Alert02Icon,
  Copy01Icon,
  Key01Icon,
  SquareLock02Icon,
  Tick02Icon,
  ViewIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { copyToClipboard } from "@/shared/lib/clipboard";

import type { SshKey } from "./data/ssh-keys";
import type { KeyServer } from "./data/use-key-servers";

import { keyTypeLabel, timeAgoOrNull, truncateFingerprint } from "./data/ssh-keys";
import { DeleteKeyButton } from "./delete-dialog";
import { KeyDetail } from "./key-detail";
import { RotateKeyButton } from "./rotate-dialog";
import { ServerChip } from "./server-chip";

/** Column template shared by the ledger header and every row. */
export const LEDGER_COLUMNS = "xl:grid-cols-[minmax(250px,1.25fr)_minmax(200px,1.1fr)_170px_232px]";

export function KeyRow({
  sshKey,
  servers,
  canManage,
}: {
  sshKey: SshKey;
  servers: KeyServer[];
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const copyFingerprint = () => {
    void copyToClipboard(sshKey.fingerprint).then((ok) => {
      if (!ok) {
        toast.error("Couldn't copy the fingerprint");
        return;
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };

  const created = timeAgoOrNull(sshKey.createdAt);
  const lastUsed = timeAgoOrNull(sshKey.lastUsedAt);

  return (
    <li>
      <div
        className={`grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-2.5 transition-colors hover:bg-muted/40 xl:min-h-16 ${LEDGER_COLUMNS}`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground ring-1 ring-foreground/10">
            <HugeiconsIcon icon={Key01Icon} strokeWidth={2} className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium">{sshKey.name}</span>
              <Badge variant="outline" className="font-mono">
                {keyTypeLabel(sshKey)}
              </Badge>
              {sshKey.hasPrivateKey ? null : (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Badge variant="secondary" className="cursor-default text-muted-foreground">
                        <HugeiconsIcon icon={SquareLock02Icon} strokeWidth={2} />
                        Public only
                      </Badge>
                    }
                  />
                  <TooltipContent side="top">
                    Imported: otterdeploy holds only the public half, so it can't sign in with it
                  </TooltipContent>
                </Tooltip>
              )}
              {sshKey.type === "rsa" && (
                <Badge variant="outline" className="text-warning">
                  <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
                  consider ed25519
                </Badge>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-0.5">
              <code
                className="font-mono text-[11.5px] text-muted-foreground"
                title={sshKey.fingerprint}
              >
                {truncateFingerprint(sshKey.fingerprint)}
              </code>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground"
                aria-label={t("sshKeys.copyFingerprint")}
                onClick={copyFingerprint}
              >
                <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} strokeWidth={2} />
              </Button>
            </div>
          </div>
        </div>

        <div className="col-span-2 flex flex-wrap items-center gap-1 pl-11 text-[13px] xl:col-span-1 xl:pl-0">
          {servers.length > 0 ? (
            servers.map((s) => <ServerChip key={s.serverId} server={s} />)
          ) : (
            <span className="text-muted-foreground">Not used</span>
          )}
        </div>

        <div className="col-span-2 pl-11 text-xs leading-normal text-muted-foreground xl:col-span-1 xl:pl-0">
          <div>
            {sshKey.imported ? "imported" : "generated"}{" "}
            {created ? <span className="font-mono">{created}</span> : null}
          </div>
          <div>
            {lastUsed ? (
              <>
                last used <span className="font-mono">{lastUsed}</span>
              </>
            ) : (
              "never used"
            )}
          </div>
        </div>

        <div className="col-start-2 row-start-1 flex items-center justify-end gap-1 xl:col-start-auto xl:row-start-auto">
          <Button
            variant="outline"
            size="xs"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <HugeiconsIcon icon={open ? ViewOffIcon : ViewIcon} strokeWidth={2} />
            {open ? "Hide" : t("sshKeys.publicKey")}
          </Button>
          {canManage && sshKey.hasPrivateKey ? (
            <RotateKeyButton sshKey={sshKey} servers={servers} />
          ) : null}
          {canManage ? <DeleteKeyButton sshKey={sshKey} servers={servers} /> : null}
        </div>
      </div>
      {open ? <KeyDetail sshKey={sshKey} /> : null}
    </li>
  );
}
