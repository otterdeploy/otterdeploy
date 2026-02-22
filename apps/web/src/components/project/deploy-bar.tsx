import { motion } from "motion/react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { Button } from "@/components/ui/button";
import { EllipsisVerticalIcon, RocketIcon } from "lucide-react";

export function DeployBar({
  changeCount,
  onDeploy,
  onDismiss,
}: {
  changeCount: number;
  onDeploy: () => void;
  onDismiss: () => void;
}) {
  useHotkey("Shift+Enter", (e) => {
    e.preventDefault();
    onDeploy();
  });

  if (changeCount === 0) return null;

  return (
    <motion.div
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -20, opacity: 0 }}
      className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 rounded-xl border border-border/60 bg-card/95 backdrop-blur-sm px-1.5 py-1.5 shadow-lg"
    >
      <span className="text-sm text-foreground/80 px-3">
        Apply {changeCount} {changeCount === 1 ? "change" : "changes"}
      </span>
      <Button variant="outline" size="sm" className="rounded-lg" onClick={onDismiss}>
        Details
      </Button>
      <Button size="sm" className="rounded-lg gap-2" onClick={onDeploy}>
        <RocketIcon className="size-3.5" />
        Deploy
        <kbd className="pointer-events-none ml-0.5 inline-flex items-center gap-0.5 rounded border border-primary-foreground/20 bg-primary-foreground/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary-foreground/70">
          ⇧+Enter
        </kbd>
      </Button>
      <Button variant="ghost" size="sm" className="size-7 p-0 rounded-lg text-muted-foreground">
        <EllipsisVerticalIcon className="size-4" />
      </Button>
    </motion.div>
  );
}
