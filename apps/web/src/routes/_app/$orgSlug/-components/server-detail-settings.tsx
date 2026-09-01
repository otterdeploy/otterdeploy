/**
 * Settings tab: everything an operator can change about a registered server
 * today, and the facts they cannot. Scheduling and cluster role are swarm
 * procedures and say so on plain Docker; the firewall re-apply and removal
 * work on every runtime. Name, thresholds and reporting cadence have no
 * write procedure yet and are not offered as editable.
 */
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Server } from "@/features/servers/data/server";
import type { SwarmNode, SwarmNodesView } from "@/features/servers/data/swarm";

import { serverCollection } from "@/features/servers/data/server";
import { isControlPlaneRow } from "@/features/servers/detail/server-state";
import { SettingsRow, SettingsSection } from "@/shared/components/settings-section";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { orpc } from "@/shared/server/orpc";

import { KeyValueList } from "./server-detail-parts";
import { AvailabilitySelect } from "./servers-row";
import { ServerDeleteButton } from "./servers-row-delete";
import { RemoveFromSwarmAction, RoleChangeAction } from "./servers-swarm-actions";

const FIREWALL_TONE: Record<Server["firewallStatus"], string> = {
  applied: "border-success/30 bg-success/10 text-success",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
  unsupported: "text-muted-foreground",
  unknown: "text-muted-foreground",
};

function FirewallControl({ server }: { server: Server }) {
  const reapply = useMutation({
    ...orpc.server.reapplyFirewall.mutationOptions(),
    onSuccess: (updated) => {
      serverCollection.utils.writeUpdate(updated);
      toast.success(`Firewall re-applied on ${server.name}`);
    },
    onError: (err) => toast.error(err.message || "Couldn't re-apply the firewall"),
  });
  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className={`h-5 px-2 text-xs ${FIREWALL_TONE[server.firewallStatus]}`}>
        {server.firewallStatus}
      </Badge>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7"
        disabled={reapply.isPending || server.firewallStatus === "unsupported"}
        onClick={() => reapply.mutate({ id: server.id })}
      >
        {reapply.isPending ? "Applying…" : "Re-apply"}
      </Button>
    </div>
  );
}

function ClusterRole({
  server,
  node,
  swarmView,
  onRemoved,
}: {
  server: Server;
  node: SwarmNode | null;
  swarmView: SwarmNodesView | null;
  onRemoved: () => void;
}) {
  if (!swarmView?.swarm) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        Node roles and swarm membership need the Docker Swarm runtime. This install runs plain
        Docker.
      </p>
    );
  }
  if (!node) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        No swarm node matches this server&apos;s hostname. It may not have joined yet.
      </p>
    );
  }
  const managerCount = swarmView.nodes.filter((n) => n.role === "manager").length;
  return (
    <div className="flex flex-col gap-3">
      <SettingsRow
        title={node.role === "manager" ? "Manager" : "Worker"}
        description={
          node.role === "manager"
            ? `Participates in Raft consensus and can schedule services.${node.leader ? " Current leader." : ""}`
            : "Runs tasks only. Promote it to join the Raft manager set."
        }
        control={<RoleChangeAction node={node} managerCount={managerCount} variant="outline" />}
      />
      <RemoveFromSwarmAction server={server} node={node} onRemoved={onRemoved} />
    </div>
  );
}

export function ServerSettingsTab({
  server,
  node,
  swarmView,
  onRemoved,
}: {
  server: Server;
  node: SwarmNode | null;
  swarmView: SwarmNodesView | null;
  onRemoved: () => void;
}) {
  const isSwarm = swarmView?.swarm ?? false;
  const local = isControlPlaneRow(server);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <SettingsSection
        title="Scheduling"
        description="Whether swarm may place new tasks here. Drain moves existing tasks off; pause only stops new ones."
      >
        <SettingsRow
          title="Availability"
          description={isSwarm ? "Applied to the swarm node immediately." : "Plain Docker has no scheduler; every service runs on this host."}
          control={
            isSwarm ? (
              <AvailabilitySelect server={server} className="h-8 w-[140px]" />
            ) : (
              <span className="font-mono text-[12px] text-muted-foreground">{server.availability}</span>
            )
          }
        />
      </SettingsSection>

      <SettingsSection title="Cluster role" description="Manager or worker in the swarm, and leaving it.">
        <div className="px-4 py-3">
          <ClusterRole server={server} node={node} swarmView={swarmView} onRemoved={onRemoved} />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Firewall"
        description="The host firewall otterdeploy manages on this machine (nftables + CrowdSec bouncer)."
      >
        <SettingsRow
          title="Managed rules"
          description={server.firewallError ?? (server.firewallBouncerActive ? "CrowdSec bouncer active." : "Bouncer not active.")}
          control={<FirewallControl server={server} />}
        />
      </SettingsSection>

      <SettingsSection title="Machine" description="How this server was registered. Facts the host reports live on Overview.">
        <KeyValueList
          className="py-1"
          items={[
            { label: "SSH", value: `${server.sshUser}@${server.host}:${server.sshPort}` },
            { label: "Mesh", value: server.meshAddress ? `${server.meshProvider} · ${server.meshAddress}` : server.meshProvider },
            { label: "Region", value: server.region ?? "–" },
            { label: "Labels", value: server.labels.length ? server.labels.join(", ") : "–" },
            { label: "Build server", value: server.buildServer ? (server.buildLane ?? "yes") : "no" },
            { label: "Registered role", value: server.role },
          ]}
        />
      </SettingsSection>

      <SettingsSection
        title="Remove"
        description="Un-register this host from the organization. The machine is left running; nothing is uninstalled."
        className="ring-destructive/30"
      >
        <SettingsRow
          title={local ? "This is the control plane" : `Remove ${server.name}`}
          description={
            local
              ? "The row that represents this install cannot be removed."
              : "Drain it first if anything still runs here. You can add it back at any time."
          }
          control={local ? null : <ServerDeleteButton server={server} />}
        />
      </SettingsSection>
    </div>
  );
}
