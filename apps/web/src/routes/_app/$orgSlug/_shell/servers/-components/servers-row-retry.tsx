/**
 * Recovery action for a failed provisioning run.
 *
 * The row is already persisted with its error, and `server.retryProvision`
 * re-runs the job in place, but only when a managed key is on file. A
 * one-time password or a mesh auth key is never stored, so those runs have
 * nothing left to reconnect with; there we link to Add a server's SSH tab
 * prefilled from the failed row (`?from=`) instead of making the operator
 * retype it.
 */

import { useState } from "react";

import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { serverCollection, type Server } from "@/features/servers/data/server";
import { Button } from "@/shared/components/ui/button";
import { orpc } from "@/shared/server/orpc";

/** True when the run stored a credential we can reconnect with. */
function canRetryInPlace(server: Server): boolean {
  return server.sshKeyId != null && server.meshProvider === "none";
}

export function ProvisionRetryCell({ server, orgSlug }: { server: Server; orgSlug: string }) {
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
            ? "This run used a one-time password, which is never stored. Re-add the server to supply it again."
            : "Mesh auth keys are never stored. Re-add the server to supply it again."
        }
        nativeButton={false}
        render={
          <Link
            to="/$orgSlug/servers/new/ssh"
            params={{ orgSlug }}
            search={{ from: server.id }}
            onClick={(event) => event.stopPropagation()}
          />
        }
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
