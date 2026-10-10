/**
 * Rotate a generated key. The button says what a rotation touches (how many
 * servers it re-authorizes); the dialog lists those servers before, while and
 * after it runs. The backend pushes the new key over the current one, checks
 * it, swaps, then removes the old key, and stops without changing anything if
 * any server can't take the new key (od-tbgu). The dialog reports that per
 * server, in the same list it showed before the click.
 */

import { useState } from "react";

import { Alert02Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { isDefinedError } from "@orpc/client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { SshKey } from "./data/ssh-keys";
import type { KeyServer } from "./data/use-key-servers";
import type { Outcome } from "./rotate-parts";

import { isUnreachable, rotateTooltip } from "./data/key-copy";
import { plural } from "./data/ssh-keys";
import { RotateCopy, RotateErrors, RotateFootnote, ServerOutcome } from "./rotate-parts";
import { ServerList } from "./server-list";

function dialogTitle(name: string, outcome: Outcome | null): string {
  if (outcome?.kind === "failed") return `“${name}” was not rotated`;
  if (outcome?.kind === "rotated") return `Rotated “${name}”`;
  return `Rotate “${name}”?`;
}

function confirmLabel(servers: KeyServer[], pending: boolean): string {
  if (pending) return "Rotating…";
  return servers.length > 0 ? `Rotate on ${plural(servers.length, "server")}` : "Rotate";
}

export function RotateKeyButton({ sshKey, servers }: { sshKey: SshKey; servers: KeyServer[] }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const down = servers.filter(isUnreachable);

  const rotate = useMutation(
    orpc.sshKeys.rotate.mutationOptions({
      onSuccess: (key) => {
        setOutcome({ kind: "rotated", fingerprint: key.fingerprint, results: key.servers });
        toast.success(`Rotated ${sshKey.name}`);
      },
      onError: (err) => {
        if (isDefinedError(err) && err.code === "ROTATE_FAILED") {
          setOutcome({ kind: "failed", results: err.data.servers });
          return;
        }
        setOpen(false);
        toast.error(err instanceof Error ? err.message : "Couldn't rotate the key");
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: orpc.sshKeys.list.queryKey() }),
    }),
  );

  const onOpenChange = (next: boolean) => {
    if (rotate.isPending) return;
    setOpen(next);
    if (!next) {
      setOutcome(null);
      rotate.reset();
    }
  };

  const resultFor = (s: KeyServer) => outcome?.results.find((r) => r.serverId === s.serverId);

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setOpen(true)}
            >
              <HugeiconsIcon icon={down.length > 0 ? Alert02Icon : RefreshIcon} strokeWidth={2} />
              <span className={down.length > 0 ? "text-warning" : undefined}>Rotate</span>
            </Button>
          }
        />
        <TooltipContent side="top">{rotateTooltip(servers)}</TooltipContent>
      </Tooltip>

      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent className="data-[size=default]:sm:max-w-[560px]">
          <AlertDialogHeader>
            <AlertDialogTitle>{dialogTitle(sshKey.name, outcome)}</AlertDialogTitle>
            <AlertDialogDescription render={<div />}>
              <RotateCopy servers={servers} outcome={outcome} />
            </AlertDialogDescription>
          </AlertDialogHeader>

          {servers.length > 0 ? (
            <ServerList
              servers={servers}
              right={(s) => (
                <ServerOutcome server={s} pending={rotate.isPending} result={resultFor(s)} />
              )}
            />
          ) : null}

          <RotateErrors outcome={outcome} />
          <RotateFootnote servers={servers} outcome={outcome} />

          <AlertDialogFooter>
            {outcome ? (
              <Button size="sm" onClick={() => onOpenChange(false)}>
                {outcome.kind === "rotated" ? "Done" : "Close"}
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={rotate.isPending}
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={rotate.isPending}
                  onClick={() => rotate.mutate({ id: sshKey.id })}
                >
                  {confirmLabel(servers, rotate.isPending)}
                </Button>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
