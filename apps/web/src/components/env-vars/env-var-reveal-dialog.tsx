import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@otterstack/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@otterstack/ui/components/ui/dialog";
import { Input } from "@otterstack/ui/components/ui/input";
import { Label } from "@otterstack/ui/components/ui/label";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";
import { toUserMessage } from "@/lib/result";

type EnvVarRevealDialogProps = {
  variableId: string | null;
  onClose: () => void;
  onRevealed: (variableId: string, value: string) => void;
};

export function EnvVarRevealDialog({ variableId, onClose, onRevealed }: EnvVarRevealDialogProps) {
  const [reason, setReason] = useState("");
  const revealMutation = useMutation(orpc.environmentVariable.reveal.mutationOptions());

  async function handleReveal(e: React.FormEvent) {
    e.preventDefault();
    if (!variableId) return;

    try {
      const result = await revealMutation.mutateAsync({
        variableId,
        reason,
      });
      onRevealed(variableId, result.value);
      setReason("");
    } catch (error) {
      toast.error(toUserMessage(error, "Failed to reveal variable"));
    }
  }

  return (
    <Dialog
      open={!!variableId}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setReason("");
        }
      }}
    >
      <DialogContent>
        <form onSubmit={handleReveal}>
          <DialogHeader>
            <DialogTitle>Reveal secret value</DialogTitle>
            <DialogDescription>
              Please provide a reason for viewing this secret. This action is logged for audit purposes.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="reveal-reason">Reason</Label>
            <Input
              id="reveal-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Debugging production issue"
              required
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!reason || revealMutation.isPending}
            >
              {revealMutation.isPending ? "Revealing..." : "Reveal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
