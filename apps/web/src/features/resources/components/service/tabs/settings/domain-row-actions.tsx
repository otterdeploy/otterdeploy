/**
 * The controls at the end of a domain row: the on/off switch, Copy URL,
 * Remove, and a ⋯ menu for the rest (Set primary, Edit).
 *
 * The status chips, Recheck DNS and the always-open DNS box that used to sit
 * here moved into the globe's card (./domain-status-card): the row keeps only
 * what an operator reaches for without needing to know the host's state.
 * Every control is a 32px hit area.
 */

import { useState } from "react";

import {
  Copy01Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  StarIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { TypedConfirmDialog } from "@/shared/components/typed-confirm-dialog";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Switch } from "@/shared/components/ui/switch";
import { copyToClipboard } from "@/shared/lib/clipboard";
import { cn } from "@/shared/lib/utils";

import type { DomainView } from "./domains-card-parts";

export function DomainRowActions({
  domain,
  busy,
  onSetEnabled,
  onSetPrimary,
  onEdit,
  onRemove,
}: {
  domain: DomainView;
  busy: boolean;
  onSetEnabled: (enabled: boolean) => void;
  onSetPrimary: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  // Removing a host takes it off the internet for every visitor: a styled
  // confirm. Pausing it is the switch beside it, undone the same way.
  const [confirmRemove, setConfirmRemove] = useState(false);
  const canSetPrimary = !domain.isPrimary && domain.status === "live";

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {/* Pause/resume without deleting: checked while the operator hasn't
          paused it, whatever the system gate currently says. The switch's own
          hit area already extends past its track. */}
      <span className="grid h-8 w-11 place-items-center">
        <Switch
          checked={domain.status !== "paused"}
          onCheckedChange={onSetEnabled}
          disabled={busy}
          aria-label={t("domains.serveDomain", { domain: domain.domain })}
        />
      </span>
      <CopyUrlButton url={`https://${domain.domain}`} />
      <Button
        size="icon"
        variant="ghost"
        aria-label={t("domains.removeDomain")}
        title={t("domains.removeDomain")}
        disabled={busy}
        onClick={() => setConfirmRemove(true)}
        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("domains.moreActions", { domain: domain.domain })}
              className="text-muted-foreground"
            />
          }
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {canSetPrimary ? (
            <DropdownMenuItem disabled={busy} onClick={onSetPrimary}>
              <HugeiconsIcon icon={StarIcon} strokeWidth={2} />
              {t("domains.setPrimary")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem disabled={busy} onClick={onEdit}>
            <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
            {t("domains.editDomain")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TypedConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t("domains.removeTitle", { domain: domain.domain })}
        description={t("domains.removeBody", { url: `https://${domain.domain}` })}
        confirmLabel={t("domains.removeDomain")}
        onConfirm={() => {
          setConfirmRemove(false);
          onRemove();
        }}
      />
    </div>
  );
}

/** Copy the URL and say so, briefly, right where the click happened. */
function CopyUrlButton({ url }: { url: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <span className="relative">
      <Button
        size="icon"
        variant="ghost"
        aria-label={t("domains.copyUrl")}
        title={t("domains.copyUrl")}
        className={cn("text-muted-foreground", copied && "text-success hover:text-success")}
        onClick={() => {
          void copyToClipboard(url).then((ok) => {
            if (!ok) return;
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          });
        }}
      >
        <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} strokeWidth={2} />
      </Button>
      {copied ? (
        <span
          role="status"
          className="pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs font-medium whitespace-nowrap text-background"
        >
          {t("common.copied")}
        </span>
      ) : null}
    </span>
  );
}
