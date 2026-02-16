import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon, EyeIcon, PencilEdit01Icon } from "@hugeicons/core-free-icons";
import { Badge } from "@otterstack/ui/components/ui/badge";
import { Button } from "@otterstack/ui/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@otterstack/ui/components/ui/table";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";
import { toUserMessage } from "@/lib/result";

import { EnvVarRevealDialog } from "./env-var-reveal-dialog";

type EnvVar = {
  id: string;
  key: string;
  scope: string;
  isSecret: boolean;
  buildTime: boolean;
};

type EnvVarTableProps = {
  variables: EnvVar[];
  projectId: string;
  onEdit: (variable: EnvVar) => void;
};

export function EnvVarTable({ variables, projectId, onEdit }: EnvVarTableProps) {
  const queryClient = useQueryClient();
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [revealedValues, setRevealedValues] = useState<Record<string, string>>({});

  const deleteMutation = useMutation(orpc.environmentVariable.delete.mutationOptions());

  async function handleDelete(variableId: string) {
    try {
      await deleteMutation.mutateAsync({ variableId });
      await queryClient.invalidateQueries({ queryKey: orpc.environmentVariable.list.key() });
      toast.success("Variable deleted");
    } catch (error) {
      toast.error(toUserMessage(error, "Failed to delete variable"));
    }
  }

  function handleRevealed(variableId: string, value: string) {
    setRevealedValues((prev) => ({ ...prev, [variableId]: value }));
    setRevealingId(null);
    setTimeout(() => {
      setRevealedValues((prev) => {
        const next = { ...prev };
        delete next[variableId];
        return next;
      });
    }, 30000);
  }

  if (variables.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <h3 className="text-lg font-semibold">No environment variables</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Add your first environment variable to get started.
        </p>
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Key</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead>Value</TableHead>
            <TableHead>Flags</TableHead>
            <TableHead className="w-32">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {variables.map((v) => (
            <TableRow key={v.id}>
              <TableCell className="font-mono text-sm">{v.key}</TableCell>
              <TableCell>
                <Badge variant="outline">{v.scope}</Badge>
              </TableCell>
              <TableCell className="font-mono text-sm">
                {revealedValues[v.id] ? (
                  <span className="break-all">{revealedValues[v.id]}</span>
                ) : (
                  <span className="text-muted-foreground">
                    {v.isSecret ? "••••••••" : "(hidden)"}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  {v.isSecret && <Badge variant="secondary">Secret</Badge>}
                  {v.buildTime && <Badge variant="secondary">Build</Badge>}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  {v.isSecret && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRevealingId(v.id)}
                    >
                      <HugeiconsIcon icon={EyeIcon} strokeWidth={2} className="size-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onEdit(v)}
                  >
                    <HugeiconsIcon icon={PencilEdit01Icon} strokeWidth={2} className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(v.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <EnvVarRevealDialog
        variableId={revealingId}
        onClose={() => setRevealingId(null)}
        onRevealed={handleRevealed}
      />
    </>
  );
}
