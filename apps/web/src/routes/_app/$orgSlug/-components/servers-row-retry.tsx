/**
 * Recovery action for a failed provisioning run.
 *
 * The row is already persisted with its error, and `server.retryProvision`
 * re-runs the job in place — but only when a managed key is on file. A
 * one-time password or a mesh auth key is never stored, so those runs have
 * nothing left to reconnect with; there we offer a re-add prefilled from the
 * failed row instead of making the operator retype it.
 */

import { useState } from "react";

import { toast } from "sonner";

import { serverCollection, type Server } from "@/features/servers/data/server";
import type { ProvisionInitialValues } from "@/features/servers/components/server-provision-form";
import { Button } from "@/shared/components/ui/button";
import { orpc } from "@/shared/server/orpc";

/** Carry over everything the operator typed except the secret. */
function reAddValuesOf(server: Server): ProvisionInitialValues {
  return {
    name: server.name,
    host: server.host,
    sshUser: server.sshUser,
    sshPort: String(server.sshPort),
    role: server.role,
    buildServer: server.buildServer,
    meshProvider: server.meshProvider,
  };
}

/** True when the run stored a credential we can reconnect with. */
function canRetryInPlace(server: Server): boolean {
  return server.sshKeyId != null && server.meshProvider === "none";
}

export function ProvisionRetryCell({
  server,
  onReAdd,
}: {
  server: Server;
  onReAdd: (initial: ProvisionInitialValues) => void;
}) {
  const [retrying, setRetrying] = useState(false);
  if (server.provisionStatus !== "failed") return null;

  if (!canRetryInPlace(server)) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-7"
        title={
          server.meshProvider === "none"
            ? "This run used a one-time password, which is never stored — re-add to supply it again."
            : "Mesh auth keys are never stored — re-add to supply it again."
        }
        onClick={(event) => {
          event.stopPropagation();
          onReAdd(reAddValuesOf(server));
        }}
      >
        Re-add
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7"
      disabled={retrying}
      onClick={(event) => {
        event.stopPropagation();
        setRetrying(true);
        orpc.server.retryProvision
          .call({ id: server.id })
          .then((updated) => {
            serverCollection.utils.writeUpdate(updated);
            toast.success(`${server.name}: provisioning restarted`);
          })
          .catch((err: unknown) => {
            toast.error(err instanceof Error ? err.message : `Couldn't retry ${server.name}`);
          })
          .finally(() => setRetrying(false));
      }}
    >
      {retrying ? "Retrying…" : "Retry"}
    </Button>
  );
}
