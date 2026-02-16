import { useMemo, useState } from "react";

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
import { NativeSelect, NativeSelectOption } from "@otterstack/ui/components/ui/native-select";

import {
  parseResourceKind,
  parseResourceStatus,
  type ResourceKind,
  type ResourceStatus,
  resourceKinds,
  resourceStatuses,
} from "./types";

type CreateResourceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: { name: string; kind: ResourceKind; status: ResourceStatus }) => Promise<void>;
};

export function CreateResourceDialog({ open, onOpenChange, onSubmit }: CreateResourceDialogProps) {
  const [name, setName] = useState("New Service");
  const [kind, setKind] = useState<ResourceKind>("web");
  const [status, setStatus] = useState<ResourceStatus>("online");
  const [isPending, setIsPending] = useState(false);

  const canSubmit = useMemo(() => name.trim().length > 0 && !isPending, [isPending, name]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#13192d] text-slate-100">
        <DialogHeader>
          <DialogTitle>Create resource</DialogTitle>
          <DialogDescription className="text-slate-400">
            Add a service, datastore, or worker node to your architecture graph.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-slate-300" htmlFor="create-resource-name">
              Name
            </label>
            <Input
              id="create-resource-name"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              className="border-white/20 bg-white/5 text-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-slate-300" htmlFor="create-resource-kind">
                Kind
              </label>
              <NativeSelect
                id="create-resource-kind"
                value={kind}
                onChange={(event) => setKind(parseResourceKind(event.currentTarget.value, kind))}
                className="w-full"
              >
                {resourceKinds.map((value) => {
                  return (
                    <NativeSelectOption key={value} value={value}>
                      {value}
                    </NativeSelectOption>
                  );
                })}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-300" htmlFor="create-resource-status">
                Status
              </label>
              <NativeSelect
                id="create-resource-status"
                value={status}
                onChange={(event) =>
                  setStatus(parseResourceStatus(event.currentTarget.value, status))
                }
                className="w-full"
              >
                {resourceStatuses.map((value) => {
                  return (
                    <NativeSelectOption key={value} value={value}>
                      {value}
                    </NativeSelectOption>
                  );
                })}
              </NativeSelect>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={async () => {
              setIsPending(true);
              try {
                await onSubmit({
                  name: name.trim(),
                  kind,
                  status,
                });
                onOpenChange(false);
              } finally {
                setIsPending(false);
              }
            }}
          >
            Add resource
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
