/**
 * Promote/demote + remove-from-swarm actions shared by the Managers & quorum
 * card and the server health sheet. Every mutation goes through the styled
 * confirm (never window.confirm) and states its quorum consequence — the
 * server re-checks the same guards authoritatively (last manager, leader,
 * down-only removal) and answers with a clear 409 when the topology moved
 * under us.
 */
import { useState } from "react";

import { toast } from "sonner";

import { serverCollection, type Server } from "@/features/servers/data/server";
import { refetchSwarmNodes, type SwarmNode } from "@/features/servers/data/swarm";
import { orpc } from "@/shared/server/orpc";
import { TypedConfirmDialog } from "@/shared/components/typed-confirm-dialog";
import { Button } from "@/shared/components/ui/button";

/** Raft majority — mirror of the server-side guard math (swarm-guards.ts). */
export function quorumRequired(managerCount: number): number {
  return Math.floor(Math.max(0, managerCount) / 2) + 1;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Promote (worker → manager) or demote (manager → worker) with a confirm
 * that spells out the resulting quorum. Blocked states render a disabled
 * button with the reason as `title` — mirroring the server guards so the
 * refusal is visible before a round-trip, never instead of one.
 */
export function RoleChangeAction({
  node,
  managerCount,
  variant = "ghost",
}: {
  node: SwarmNode;
  managerCount: number;
  variant?: "ghost" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const promote = node.role === "worker";
  const nextManagers = promote ? managerCount + 1 : managerCount - 1;

  const blockedReason =
    node.serverId === null
      ? "This node isn't registered as a server — add it on this page first"
      : !promote && node.leader
        ? "The swarm leader can't be demoted — promote another manager and let leadership move first"
        : !promote && managerCount <= 1
          ? "The last manager can't be demoted — the swarm would be left unmanageable"
          : null;

  const confirmRole = () => {
    const serverId = node.serverId;
    if (serverId === null) return;
    setPending(true);
    orpc.server.setRole
      .call({ id: serverId, role: promote ? "manager" : "worker" })
      .then((updated) => {
        serverCollection.utils.writeUpdate(updated);
        refetchSwarmNodes();
        toast.success(
          `${node.hostname} ${promote ? "promoted to manager" : "demoted to worker"} — quorum is now ${quorumRequired(nextManagers)} of ${nextManagers}`,
        );
        setOpen(false);
      })
      .catch((err: unknown) => {
        toast.error(errorMessage(err, `Couldn't change the role of ${node.hostname}`));
      })
      .finally(() => setPending(false));
  };

  return (
    <>
      <Button
        variant={variant}
        size="sm"
        className="h-7 px-2 text-[12px]"
        disabled={blockedReason !== null}
        title={blockedReason ?? undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {promote ? "Promote" : "Demote"}
      </Button>
      <TypedConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={promote ? `Promote ${node.hostname} to manager` : `Demote ${node.hostname} to worker`}
        description={
          promote
            ? `The manager set grows to ${nextManagers} — quorum becomes ${quorumRequired(nextManagers)} of ${nextManagers}. An even manager count tolerates no more failures than the next odd one down.`
            : `Demoting drops quorum to ${quorumRequired(nextManagers)} of ${nextManagers} manager${nextManagers === 1 ? "" : "s"}. The node keeps running its tasks as a worker.`
        }
        confirmLabel={promote ? "Promote" : "Demote"}
        pendingLabel={promote ? "Promoting…" : "Demoting…"}
        pending={pending}
        onConfirm={confirmRole}
      />
    </>
  );
}

/**
 * Danger-area removal: `docker node rm`, down-only (the force flag is
 * deliberately not exposed). On success the server row is deleted through
 * the collection's normal delete flow so the table stays truthful.
 */
export function RemoveFromSwarmAction({
  server,
  node,
  onRemoved,
}: {
  server: Server;
  node: SwarmNode;
  onRemoved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const isDown = node.state === "down";

  const confirmRemove = () => {
    setPending(true);
    orpc.server.removeNode
      .call({ id: server.id })
      .then(() => {
        // Swarm confirmed the detach — now drop the row via the collection so
        // the table updates through the same path as a manual delete.
        serverCollection.delete(server.id);
        refetchSwarmNodes();
        toast.success(`${node.hostname} removed from the swarm`);
        setOpen(false);
        onRemoved();
      })
      .catch((err: unknown) => {
        toast.error(errorMessage(err, `Couldn't remove ${node.hostname} from the swarm`));
        setPending(false);
      });
  };

  return (
    <div className="flex flex-col gap-2 rounded-md p-3 ring-1 ring-destructive/30">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium">Remove from swarm</div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">
            {isDown
              ? "Detaches the node and deletes this server. The host itself is untouched."
              : `Only nodes the swarm reports as down can be removed — this node is ${node.state}. Drain it and stop its daemon first.`}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 px-2 text-[12px] text-destructive hover:text-destructive"
          disabled={!isDown}
          onClick={() => setOpen(true)}
        >
          Remove
        </Button>
      </div>
      <TypedConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Remove ${node.hostname} from the swarm`}
        description={`The node is detached from the swarm and this server row is deleted. To bring the host back it must re-join with a fresh join token. This can't be undone.`}
        confirmPhrase={node.hostname}
        confirmLabel="Remove node"
        pendingLabel="Removing…"
        pending={pending}
        onConfirm={confirmRemove}
      />
    </div>
  );
}
