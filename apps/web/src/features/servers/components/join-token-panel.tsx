import { useState } from "react";

import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/shared/components/ui/toggle-group";
import { cn } from "@/shared/lib/utils";

// TODO: pull from the active org's manager + a real swarm.joinToken procedure
// once that lands in packages/api. Worker vs manager tokens are issued by
// `docker swarm join-token <role> -q` on the manager.
export const MANAGER_ADDR = "10.0.0.11:2377";
const WORKER_TOKEN =
  "SWMTKN-1-3pe4v5z9qpz2m9k4n6h7r8s2t1u0v9w8x7y6z-4w7r8t9u0v2x3y4z5a6b7c";
const MANAGER_TOKEN =
  "SWMTKN-1-mgr-9z8y7x6w5v4u3t2s1r0q9p-3m4n5o6p7q8r9s0t1u2v";

export type JoinRole = "worker" | "manager";

interface JoinTokenPanelProps {
  role: JoinRole;
  onRoleChange: (role: JoinRole) => void;
}

export function JoinTokenPanel({ role, onRoleChange }: JoinTokenPanelProps) {
  const command =
    role === "worker"
      ? `docker swarm join --token ${WORKER_TOKEN} ${MANAGER_ADDR}`
      : `docker swarm join --token ${MANAGER_TOKEN} ${MANAGER_ADDR}`;

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

      <CommandBlock command={command} />
    </div>
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
