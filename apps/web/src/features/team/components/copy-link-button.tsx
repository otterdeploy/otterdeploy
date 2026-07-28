/**
 * Copy an invitation accept-link to the clipboard. Rendered icon-only in
 * the pending-invitations list and labelled below the invite form, so an
 * admin can share the link manually without depending on email delivery.
 */

import { useState } from "react";

import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { copyToClipboard } from "@/shared/lib/clipboard";
import { cn } from "@/shared/lib/utils";

export function CopyLinkButton({
  link,
  label,
  className,
}: {
  link: string;
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void copyToClipboard(link).then((ok) => {
      if (!ok) {
        toast.error(t("team.copyInviteFailed"));
        return;
      }
      setCopied(true);
      toast.success(t("team.inviteLinkCopied"));
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (label) {
    return (
      <Button variant="outline" size="sm" className={cn("gap-1.5", className)} onClick={copy}>
        <HugeiconsIcon
          icon={copied ? Tick02Icon : Copy01Icon}
          strokeWidth={2}
          className="size-3.5"
        />
        {copied ? "Copied" : label}
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("size-7 text-muted-foreground", className)}
      onClick={copy}
      aria-label={t("team.copyInviteLink")}
    >
      <HugeiconsIcon
        icon={copied ? Tick02Icon : Copy01Icon}
        strokeWidth={1.8}
        className="size-3.5"
      />
    </Button>
  );
}
