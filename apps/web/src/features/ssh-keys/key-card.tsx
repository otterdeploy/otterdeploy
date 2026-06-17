/**
 * One SSH key card: name, type badge, fingerprint (with copy), "used by" chips,
 * and reveal-public-key / rotate / delete actions. Generated keys can be rotated
 * (we hold the private half); imported keys can only be removed. All mutations
 * go through the `sshKeys` oRPC router and invalidate the list query on success.
 */

import { useState } from "react";
import {
  Alert02Icon,
  Copy01Icon,
  Delete02Icon,
  GitBranchIcon,
  Key01Icon,
  PackageIcon,
  RefreshIcon,
  ServerStack01Icon,
  Tick02Icon,
  ViewIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import type { SshKey } from "./data/ssh-keys";
import { timeAgo } from "./data/ssh-keys";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

const USAGE_ICON = {
  git: GitBranchIcon,
  node: ServerStack01Icon,
  service: PackageIcon,
} as const;

function truncateFingerprint(fp: string): string {
  if (fp.length <= 28) return fp;
  return `${fp.slice(0, 14)}…${fp.slice(-10)}`;
}

export function KeyCard({
  sshKey,
  canManage,
}: {
  sshKey: SshKey;
  canManage: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: orpc.sshKeys.list.queryKey() });

  const rotate = useMutation(
    orpc.sshKeys.rotate.mutationOptions({
      onSuccess: () => {
        void invalidate();
        toast.success("SSH key rotated");
      },
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "Failed to rotate key"),
    }),
  );

  const remove = useMutation(
    orpc.sshKeys.delete.mutationOptions({
      onSuccess: () => {
        void invalidate();
        toast.success("SSH key deleted");
      },
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "Failed to delete key"),
    }),
  );

  const copy = (text: string, what: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => toast.error(`Couldn't copy ${what}`));
  };

  const busy = rotate.isPending || remove.isPending;

  return (
    <div className="flex flex-col gap-3.5 rounded-md border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-md border bg-muted/40 text-muted-foreground">
          <HugeiconsIcon icon={Key01Icon} strokeWidth={2} className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-sm">{sshKey.name}</span>
            <Badge variant="outline" className="font-mono text-[11px]">
              {sshKey.type}
              {sshKey.bits ? `-${sshKey.bits}` : ""}
            </Badge>
            {sshKey.imported && (
              <Badge variant="secondary" className="text-[11px]">
                imported
              </Badge>
            )}
            {sshKey.type === "rsa" && (
              <Badge
                variant="outline"
                className="gap-1 text-[11px] text-amber-600 dark:text-amber-500"
              >
                <HugeiconsIcon
                  icon={Alert02Icon}
                  strokeWidth={2}
                  className="size-3"
                />
                consider ed25519
              </Badge>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {truncateFingerprint(sshKey.fingerprint)}
            </code>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label="Copy fingerprint"
              onClick={() => copy(sshKey.fingerprint, "fingerprint")}
            >
              <HugeiconsIcon
                icon={copied ? Tick02Icon : Copy01Icon}
                strokeWidth={2}
                className="size-3.5"
              />
            </Button>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Used by
        </div>
        {sshKey.usedBy.length === 0 ? (
          <span className="text-xs text-muted-foreground">Not in use</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {sshKey.usedBy.map((u, i) => (
              <span
                key={i}
                className="flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px]"
              >
                <HugeiconsIcon
                  icon={USAGE_ICON[u.kind]}
                  strokeWidth={2}
                  className="size-2.5 text-muted-foreground"
                />
                <span className="font-mono">{u.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {revealed && (
        <div className="rounded-md border bg-muted/30 p-2.5">
          <div className="flex items-start justify-between gap-2">
            <code className="break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
              {sshKey.publicKey}
            </code>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground"
              aria-label="Copy public key"
              onClick={() => copy(sshKey.publicKey, "public key")}
            >
              <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 border-t pt-3">
        <span className="font-mono text-[11px] text-muted-foreground">
          {timeAgo(sshKey.createdAt) && `generated ${timeAgo(sshKey.createdAt)}`}
          {sshKey.lastUsedAt && ` · last used ${timeAgo(sshKey.lastUsedAt)}`}
        </span>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5"
          onClick={() => setRevealed((v) => !v)}
        >
          <HugeiconsIcon
            icon={revealed ? ViewOffIcon : ViewIcon}
            strokeWidth={2}
            className="size-3.5"
          />
          {revealed ? "Hide" : "Public key"}
        </Button>
        {canManage && !sshKey.imported && (
          <RotateButton
            disabled={busy}
            name={sshKey.name}
            onConfirm={() => rotate.mutate({ id: sshKey.id })}
          />
        )}
        {canManage && (
          <DeleteButton
            disabled={busy}
            name={sshKey.name}
            onConfirm={() => remove.mutate({ id: sshKey.id })}
          />
        )}
      </div>
    </div>
  );
}

function RotateButton({
  name,
  disabled,
  onConfirm,
}: {
  name: string;
  disabled: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-muted-foreground"
            disabled={disabled}
          >
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
            Rotate
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rotate “{name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            A new keypair replaces this one. The old public key stops working
            immediately — re-add the new public key wherever this key is used.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            render={
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            }
          />
          <AlertDialogAction
            render={
              <Button size="sm" onClick={onConfirm}>
                Rotate
              </Button>
            }
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteButton({
  name,
  disabled,
  onConfirm,
}: {
  name: string;
  disabled: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn("text-muted-foreground hover:text-destructive")}
            aria-label="Delete SSH key"
            disabled={disabled}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Anything authenticating with this key will lose access. This can't be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            render={
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            }
          />
          <AlertDialogAction
            render={
              <Button variant="destructive" size="sm" onClick={onConfirm}>
                Delete
              </Button>
            }
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
