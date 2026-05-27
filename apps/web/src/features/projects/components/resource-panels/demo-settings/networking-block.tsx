import type { ResourceNodeData } from "@/features/projects/components/graph/resource-node";
import { Button } from "@/shared/components/ui/button";

import { SettingsBlock, SettingsRow, SubLabel } from "./atoms";

interface NetworkingBlockProps {
  node: ResourceNodeData;
  domain: string | null;
}

export function NetworkingBlock({ node, domain }: NetworkingBlockProps) {
  return (
    <SettingsBlock title="Networking">
      <SubLabel>Internal</SubLabel>
      <SettingsRow
        label="Hostname"
        value={`${node.name}.gravy-truck.internal`}
        mono
      />
      <SettingsRow label="Upstream port" value="3000" mono />
      <SettingsRow label="Network" value={`otterstack-${node.name}`} mono />

      <SubLabel className="mt-5">
        Public route{" "}
        <span className="font-mono text-muted-foreground/60">via caddy</span>
      </SubLabel>
      <SettingsRow label="Domain" value={domain ?? "—"} mono />
      <SettingsRow label="Type" value="HTTP" />
      <SettingsRow label="TLS" value="Auto · Let's Encrypt" />
      <SettingsRow
        label="Status"
        value={
          <span className="rounded bg-success/15 px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-success">
            Certified
          </span>
        }
      />
      <div className="mt-2 flex items-center gap-2">
        <Button variant="outline" size="sm">
          + Add custom domain
        </Button>
        <Button variant="outline" size="sm">
          View Caddyfile
        </Button>
      </div>
    </SettingsBlock>
  );
}
