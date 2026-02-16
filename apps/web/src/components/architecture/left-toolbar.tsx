import type { ReactNode } from "react";

import { Grid2x2, Minus, Redo2, Undo2, ZoomIn, ZoomOut } from "lucide-react";

import { Button } from "@otterstack/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@otterstack/ui/components/ui/tooltip";

type LeftToolbarProps = {
  canUndo: boolean;
  canRedo: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onUndo: () => void;
  onRedo: () => void;
};

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline" size="icon" disabled={disabled} />} onClick={onClick}>
        {children}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function LeftToolbar({
  canUndo,
  canRedo,
  onZoomIn,
  onZoomOut,
  onFitView,
  onUndo,
  onRedo,
}: LeftToolbarProps) {
  return (
    <div className="absolute left-6 top-1/2 z-20 -translate-y-1/2 rounded-2xl border border-white/10 bg-[#0e1221]/90 p-2 shadow-xl backdrop-blur">
      <div className="flex flex-col gap-1">
        <ToolButton label="Zoom in" onClick={onZoomIn}>
          <ZoomIn />
        </ToolButton>
        <ToolButton label="Zoom out" onClick={onZoomOut}>
          <ZoomOut />
        </ToolButton>
        <ToolButton label="Fit view" onClick={onFitView}>
          <Grid2x2 />
        </ToolButton>
        <div className="my-1 h-px bg-white/10" />
        <ToolButton label="Undo" onClick={onUndo} disabled={!canUndo}>
          <Undo2 />
        </ToolButton>
        <ToolButton label="Redo" onClick={onRedo} disabled={!canRedo}>
          <Redo2 />
        </ToolButton>
        <ToolButton label="Collapse" onClick={onFitView}>
          <Minus />
        </ToolButton>
      </div>
    </div>
  );
}
