/**
 * Delete a key. While a server signs in with it the button is held (dimmed,
 * the reason in its tooltip) and opens an explanation naming those servers
 * instead of a confirm: the API refuses the delete anyway, because it would
 * cut the control plane off from them (od-tbgu). An unused key gets the
 * destructive confirm, which says what deleting it does and doesn't touch.
 */

import { useState } from "react";

import { ArrowRight01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { isDefinedError } from "@orpc/client";
import { useMutation } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { SshKey } from "./data/ssh-keys";
import type { KeyServer } from "./data/use-key-servers";

import { deleteTooltip } from "./data/key-copy";
import { listNames } from "./data/ssh-keys";
import { ServerList } from "./server-list";

export function DeleteKeyButton({ sshKey, servers }: { sshKey: SshKey; servers: KeyServer[] }) {
  const { t } = useTranslation();
  const { orgSlug } = useParams({ from: "/_app/$orgSlug" });
  const [open, setOpen] = useState(false);
  const inUse = servers.length > 0;
  const one = servers.length === 1;

  const remove = useMutation(
    orpc.sshKeys.delete.mutationOptions({
      onSuccess: () => {
        setOpen(false);
        toast.success(t("sshKeys.deleted"));
      },
      onError: (err) => {
        setOpen(false);
        // A server picked this key up after the page loaded: the API names it.
        if (isDefinedError(err) && err.code === "IN_USE") {
          toast.error(
            `In use by ${listNames(err.data.servers.map((s) => s.name))}, so it wasn't deleted`,
          );
          return;
        }
        toast.error(err instanceof Error ? err.message : "Couldn't delete the key");
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: orpc.sshKeys.list.queryKey() }),
    }),
  );

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={inUse ? deleteTooltip(servers) : t("sshKeys.deleteKey")}
              className={cn(
                "text-muted-foreground",
                inUse
                  ? "opacity-50 hover:opacity-100"
                  : "hover:bg-destructive/10 hover:text-destructive",
              )}
              onClick={() => setOpen(true)}
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            </Button>
          }
        />
        <TooltipContent side="top" align="end">
          {deleteTooltip(servers)}
        </TooltipContent>
      </Tooltip>

      <AlertDialog open={open} onOpenChange={(next) => !remove.isPending && setOpen(next)}>
        {inUse ? (
          <AlertDialogContent className="data-[size=default]:sm:max-w-[560px]">
            <AlertDialogHeader>
              <AlertDialogTitle>“{sshKey.name}” is in use</AlertDialogTitle>
              <AlertDialogDescription>
                otterdeploy signs in to{" "}
                <strong className="font-medium text-foreground">
                  {one ? servers[0]?.name : `${servers.length} servers`}
                </strong>{" "}
                with this key to push edge config and repair firewalls. Deleting it would cut the
                control plane off from {one ? "that server" : "them"}.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <ServerList
              servers={servers}
              right={(s) => (
                <Button
                  variant="outline"
                  size="xs"
                  render={
                    <Link
                      to="/$orgSlug/servers/$serverId"
                      params={{ orgSlug, serverId: s.serverId }}
                      search={{ tab: "overview" }}
                    />
                  }
                >
                  Open
                  <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
                </Button>
              )}
            />
            <p className="text-sm text-muted-foreground">
              Remove {one ? "that server" : "those servers"} first to delete this key. To replace
              the key material instead, rotate it.
            </p>
            <AlertDialogFooter>
              <Button size="sm" onClick={() => setOpen(false)}>
                Got it
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        ) : (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{sshKey.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                No server uses this key.{" "}
                {sshKey.hasPrivateKey
                  ? "The private half is destroyed; anywhere you pasted the public key by hand stops matching anything."
                  : "otterdeploy only holds the public half; the private key on your machine is untouched."}{" "}
                This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                render={
                  <Button variant="outline" size="sm" disabled={remove.isPending}>
                    Cancel
                  </Button>
                }
              />
              <AlertDialogAction
                render={
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate({ id: sshKey.id })}
                  >
                    {remove.isPending ? "Deleting…" : "Delete key"}
                  </Button>
                }
              />
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </>
  );
}
