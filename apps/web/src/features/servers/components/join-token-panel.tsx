import { useState } from "react";

import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/shared/components/ui/toggle-group";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

export type JoinRole = "worker" | "manager";

/**
 * Shared hook for the swarm join tokens + manager advertise address. Both
 * the panel and the surrounding dialog descriptions read from the same
 * query — tanstack-query dedupes on queryKey so it's one network call per
 * dialog open regardless of how many places need the data.
 */
export function useSwarmJoinTokens() {
  return useQuery(orpc.server.joinTokens.queryOptions({ input: undefined }));
}

interface JoinTokenPanelProps {
  role: JoinRole;
  onRoleChange: (role: JoinRole) => void;
}

export function JoinTokenPanel({ role, onRoleChange }: JoinTokenPanelProps) {
  const { data, isLoading } = useSwarmJoinTokens();
  const token = role === "worker" ? data?.worker : data?.manager;
  const managerAddr = data?.managerAddr ?? null;

  const command =
    token && managerAddr ? `docker swarm join --token ${token} ${managerAddr}` : null;

  return (
    <div className="flex flex-col gap-3">
      <ToggleGroup
        value={[role]}
        onValueChange={(next) => {
          const v = next[0];
          if (v === "worker" || v === "manager") onRoleChange(v);
        }}
        className="self-start"
      >
        <ToggleGroupItem value="worker" aria-label="Worker join command">
          Worker
        </ToggleGroupItem>
        <ToggleGroupItem value="manager" aria-label="Manager join command">
          Manager
        </ToggleGroupItem>
      </ToggleGroup>

      {isLoading ? (
        <Skeleton className="h-16 w-full rounded-md" />
      ) : command ? (
        <CommandBlock command={command} />
      ) : (
        <div className="rounded-md border border-dashed bg-muted/20 p-3 text-[12px] text-muted-foreground">
          Swarm hasn't been initialized on this host. Run{" "}
          <code className="rounded-sm bg-muted px-1 py-px font-mono text-foreground">
            docker swarm init
          </code>{" "}
          on the manager, then refresh.
        </div>
      )}
    </div>
  );
}

/** Inline chip showing the manager join address, self-fetching so callers
 *  don't have to thread it through props. */
export function ManagerAddressChip() {
  const { data } = useSwarmJoinTokens();
  return (
    <code className="rounded-sm bg-muted px-1 py-px font-mono text-[12px] text-foreground">
      {data?.managerAddr ?? "—"}
    </code>
  );
}

function CommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="relative rounded-md border bg-muted/50 p-3 pr-11 font-mono text-[12px] leading-relaxed text-foreground/90">
      <code className="block break-all whitespace-pre-wrap">{command}</code>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy command"}
        title={copied ? "Copied" : "Copy command"}
        className={cn(
          "absolute top-2 right-2 size-7 bg-background shadow-sm",
          copied && "text-success",
        )}
      >
        <HugeiconsIcon
          icon={copied ? Tick02Icon : Copy01Icon}
          strokeWidth={2}
          className="size-3.5"
        />
      </Button>
    </div>
  );
}
