import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  ArrowReloadHorizontalIcon,
  Cancel01Icon,
  RocketIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";

import type { ResourceNodeData } from "@/features/projects/components/graph/resource-node";
import { Button } from "@/shared/components/ui/button";

import { PanelIcon } from "../atoms";

interface DemoHeaderProps {
  node: ResourceNodeData;
  repo: string;
  onClose: () => void;
}

export function DemoPanelHeader({ node, repo, onClose }: DemoHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 pt-6">
      <div className="flex items-start gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Back to graph"
          onClick={onClose}
          className="mt-1"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-4" />
        </Button>
        <PanelIcon node={node} />
        <div className="flex flex-col gap-0.5">
          <span className="text-xl font-bold leading-none tracking-tight">
            {node.name}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {node.git ? node.git.commit.slice(0, 7) : "—"}{" "}
            <span className="text-muted-foreground/50">·</span> {repo}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="default">
          <HugeiconsIcon icon={TerminalIcon} strokeWidth={1.8} className="size-3.5" />
          Terminal
        </Button>
        <Button variant="outline" size="default">
          <HugeiconsIcon
            icon={ArrowReloadHorizontalIcon}
            strokeWidth={1.8}
            className="size-3.5"
          />
          Restart
        </Button>
        <Button size="default">
          <HugeiconsIcon icon={RocketIcon} strokeWidth={1.8} className="size-3.5" />
          Redeploy
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close panel"
          onClick={onClose}
          className="ml-1"
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
        </Button>
      </div>
    </div>
  );
}
