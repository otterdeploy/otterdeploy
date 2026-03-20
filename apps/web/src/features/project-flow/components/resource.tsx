"use client";

import { Handle, Position } from "@xyflow/react";
import type React from "react";

import { cn } from "@/lib/utils";

type ResourceRootProps = React.ComponentProps<"section"> & {
  selected?: boolean;
};

function Root({ className, selected = false, ...props }: ResourceRootProps): React.ReactElement {
  return (
    <section
      className={cn(
        "relative w-[300px] rounded-2xl border border-border/60 bg-card p-1.5 shadow-sm transition-shadow",
        selected && "ring-2 ring-ring/30",
        className,
      )}
      {...props}
    />
  );
}

function TargetHandle({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Handle>, "type" | "position">): React.ReactElement {
  return (
    <Handle
      className={cn(
        "!top-[-6px] !h-3 !w-3 !border-2 !border-background !bg-muted-foreground/30 !shadow-none",
        className,
      )}
      position={Position.Top}
      type="target"
      {...props}
    />
  );
}

function SourceHandle({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Handle>, "type" | "position">): React.ReactElement {
  return (
    <Handle
      className={cn(
        "!bottom-[-6px] !h-3 !w-3 !border-2 !border-background !bg-muted-foreground/30 !shadow-none",
        className,
      )}
      position={Position.Bottom}
      type="source"
      {...props}
    />
  );
}

function Header({ className, ...props }: React.ComponentProps<"header">): React.ReactElement {
  return (
    <header
      className={cn("flex items-center gap-2.5 px-2 py-1.5 text-foreground", className)}
      {...props}
    />
  );
}

function HeaderIcon({ className, ...props }: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function HeaderTitle({ className, ...props }: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div className={cn("text-sm font-medium tracking-[-0.01em]", className)} {...props} />
  );
}

function HeaderActions({ className, ...props }: React.ComponentProps<"div">): React.ReactElement {
  return <div className={cn("ml-auto flex items-center gap-0.5", className)} {...props} />;
}

function HeaderButton({
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button">): React.ReactElement {
  return (
    <button
      className={cn(
        "nodrag nopan inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
      type={type}
      {...props}
    />
  );
}

function Surface({ className, ...props }: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/50 bg-card",
        className,
      )}
      {...props}
    />
  );
}

function SectionHeader({ className, ...props }: React.ComponentProps<"div">): React.ReactElement {
  return <div className={cn("flex items-center gap-2.5 px-3.5 py-3", className)} {...props} />;
}

function DragHandle({ className, ...props }: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "resource-drag-handle inline-flex size-6 cursor-grab items-center justify-center rounded text-muted-foreground/50 active:cursor-grabbing",
        className,
      )}
      {...props}
    />
  );
}

function SectionTitle({ className, ...props }: React.ComponentProps<"div">): React.ReactElement {
  return <div className={cn("text-sm font-semibold tracking-[-0.01em]", className)} {...props} />;
}

function SectionMeta({ className, ...props }: React.ComponentProps<"div">): React.ReactElement {
  return <div className={cn("ml-auto flex items-center gap-1.5", className)} {...props} />;
}

function Divider({ className, ...props }: React.ComponentProps<"div">): React.ReactElement {
  return <div className={cn("mx-3.5 border-t border-dashed border-border/50", className)} {...props} />;
}

function Row({ className, ...props }: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("flex items-center gap-3 px-3.5 py-2.5", className)}
      {...props}
    />
  );
}

function RowLabel({ className, ...props }: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("text-[13px] text-muted-foreground", className)}
      {...props}
    />
  );
}

function RowControl({ className, ...props }: React.ComponentProps<"div">): React.ReactElement {
  return <div className={cn("nodrag nopan ml-auto shrink-0", className)} {...props} />;
}

function Field({ className, ...props }: React.ComponentProps<"div">): React.ReactElement {
  return <div className={cn("space-y-2 px-3.5 py-2.5", className)} {...props} />;
}

function FieldLabel({ className, ...props }: React.ComponentProps<"div">): React.ReactElement {
  return <div className={cn("text-[13px] font-medium text-muted-foreground", className)} {...props} />;
}

function FieldValue({ className, ...props }: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-sm text-foreground/80",
        className,
      )}
      {...props}
    />
  );
}

export const Resource = {
  Root,
  TargetHandle,
  SourceHandle,
  Header,
  HeaderIcon,
  HeaderTitle,
  HeaderActions,
  HeaderButton,
  Surface,
  SectionHeader,
  DragHandle,
  SectionTitle,
  SectionMeta,
  Divider,
  Row,
  RowLabel,
  RowControl,
  Field,
  FieldLabel,
  FieldValue,
};
