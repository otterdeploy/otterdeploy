/**
 * Add a server: one focused dialog, mounted by the `/servers/new/*` routes over
 * the Servers page. Two ways in, as tabs: run a one-time command on the server,
 * or let otterdeploy connect over SSH and do the install itself.
 *
 * Closing navigates back to `/servers`, after the close animation has played,
 * so the URL and what is on screen never disagree.
 */

import type { ServerId } from "@otterdeploy/shared/id";

import { useState } from "react";

import { useLiveQuery } from "@tanstack/react-db";
import { useNavigate } from "@tanstack/react-router";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { TabsContent } from "@/shared/components/ui/tabs";
import { useRouteView } from "@/shared/hooks/use-route-view";

import { serverCollection } from "../data/server";
import { addServerMethod } from "./add-server-route";
import { AddServerTabs } from "./add-server-tabs";
import { useCommandFlow } from "./command-flow";
import { CommandBody, CommandFooter } from "./command-tab";
import { PanelBody } from "./panel";
import { SshForm, type SshInitialValues } from "./ssh-form";
import { SshRun } from "./ssh-run";

/** A failed server's non-secret fields, for `?from=` on the SSH tab. */
function useReAddValues(from: ServerId | undefined): SshInitialValues | undefined {
  const { data: servers } = useLiveQuery((q) => q.from({ s: serverCollection }));
  const server = from ? servers.find((s) => s.id === from) : undefined;
  if (!server) return undefined;
  return {
    host: server.host,
    sshPort: String(server.sshPort),
    sshUser: server.sshUser,
    controlPlane: server.role === "manager",
  };
}

export function AddServerDialog({
  orgSlug,
  from,
}: {
  orgSlug: string;
  /** Re-add this failed server (SSH tab only). */
  from: ServerId | undefined;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);
  const method = addServerMethod(useRouteView());
  const command = useCommandFlow();
  const [sshRun, setSshRun] = useState<ServerId | null>(null);
  const reAdd = useReAddValues(from);

  const close = () => setOpen(false);
  const showList = method === "command" ? command.phase === "confirm" : sshRun === null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) void navigate({ to: "/$orgSlug/servers", params: { orgSlug } });
      }}
    >
      <DialogContent
        className="gap-0 p-0 [--dlg-pad:0px] sm:max-w-[520px]"
        // Land on the field the tab asks for (password or address), not on
        // the tab strip: the method is already chosen by the URL.
        initialFocus={() =>
          document.querySelector<HTMLElement>("#add-server-credential, #add-server-host") ?? true
        }
      >
        <AddServerTabs
          showList={showList}
          header={
            <DialogHeader className="gap-1 pr-8">
              <DialogTitle>Add a server</DialogTitle>
              <DialogDescription>
                Install otterdeploy on a Linux machine you control.
              </DialogDescription>
            </DialogHeader>
          }
        >
          <TabsContent value="command">
            <PanelBody>
              <CommandBody flow={command} />
            </PanelBody>
            <CommandFooter flow={command} onClose={close} />
          </TabsContent>
          <TabsContent value="ssh">
            {sshRun ? (
              <SshRun serverId={sshRun} onClose={close} />
            ) : (
              <SshForm
                // TanStack Form reads its defaults on mount: a re-add whose
                // server row arrives after mount needs a fresh form.
                key={reAdd ? `readd:${from}` : "new"}
                initial={reAdd}
                onStarted={setSshRun}
                onCancel={close}
              />
            )}
          </TabsContent>
        </AddServerTabs>
      </DialogContent>
    </Dialog>
  );
}
