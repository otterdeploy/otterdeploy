import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import {
  NativeSelect,
  NativeSelectOption,
} from "@otterstack/ui/components/ui/native-select";
import { Checkbox } from "@otterstack/ui/components/ui/checkbox";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";
import { toUserMessage } from "@/lib/result";

type EditingVar = {
  id: string;
  key: string;
  scope: string;
  isSecret: boolean;
  buildTime: boolean;
} | null;

type EnvVarUpsertDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  editing: EditingVar;
};

export function EnvVarUpsertDialog({ open, onOpenChange, projectId, editing }: EnvVarUpsertDialogProps) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [scope, setScope] = useState<"project" | "environment" | "resource">("project");
  const [isSecret, setIsSecret] = useState(true);
  const [buildTime, setBuildTime] = useState(false);

  const upsertMutation = useMutation(orpc.environmentVariable.upsert.mutationOptions());

  useEffect(() => {
    if (editing) {
      setKey(editing.key);
      setValue("");
      setScope(editing.scope as "project" | "environment" | "resource");
      setIsSecret(editing.isSecret);
      setBuildTime(editing.buildTime);
    } else {
      setKey("");
      setValue("");
      setScope("project");
      setIsSecret(true);
      setBuildTime(false);
    }
  }, [editing, open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await upsertMutation.mutateAsync({
        projectId,
        scope,
        key,
        value,
        isSecret,
        buildTime,
      });
      await queryClient.invalidateQueries({ queryKey: orpc.environmentVariable.list.key() });
      toast.success(editing ? "Variable updated" : "Variable created");
      onOpenChange(false);
    } catch (error) {
      toast.error(toUserMessage(error, "Failed to save variable"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit" : "Add"} environment variable</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update the value or settings for this variable."
                : "Add a new environment variable to the project."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="var-key">Key</Label>
              <Input
                id="var-key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="DATABASE_URL"
                required
                disabled={!!editing}
                className="font-mono"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="var-value">Value</Label>
              <Input
                id="var-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Enter value..."
                required
                type={isSecret ? "password" : "text"}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="var-scope">Scope</Label>
              <NativeSelect
                id="var-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as typeof scope)}
              >
                <NativeSelectOption value="project">Project</NativeSelectOption>
                <NativeSelectOption value="environment">Environment</NativeSelectOption>
                <NativeSelectOption value="resource">Resource</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={isSecret}
                  onCheckedChange={(checked) => setIsSecret(!!checked)}
                />
                Secret
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={buildTime}
                  onCheckedChange={(checked) => setBuildTime(!!checked)}
                />
                Available at build time
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={!key || !value || upsertMutation.isPending}
            >
              {upsertMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
