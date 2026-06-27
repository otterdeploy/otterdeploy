import { useReactFlow } from "@xyflow/react";
import { MaximizeIcon, MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react";

import { Toolbar, ToolbarButton, ToolbarSeparator } from "@/components/ui/toolbar";

interface Props {
  onUndo?: () => void;
}

export function CanvasControls({ onUndo }: Props) {
  const flow = useReactFlow();
  return (
    <Toolbar className="absolute bottom-3 left-3 flex flex-col gap-1 rounded-lg border bg-background/90 p-1 shadow-sm backdrop-blur">
      <ToolbarButton aria-label="Zoom in" onClick={() => flow.zoomIn()}>
        <PlusIcon className="size-4" />
      </ToolbarButton>
      <ToolbarButton aria-label="Zoom out" onClick={() => flow.zoomOut()}>
        <MinusIcon className="size-4" />
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton aria-label="Fit view" onClick={() => flow.fitView({ padding: 0.2 })}>
        <MaximizeIcon className="size-4" />
      </ToolbarButton>
      {onUndo ? (
        <>
          <ToolbarSeparator />
          <ToolbarButton aria-label="Undo" onClick={onUndo}>
            <RotateCcwIcon className="size-4" />
          </ToolbarButton>
        </>
      ) : null}
    </Toolbar>
  );
}
