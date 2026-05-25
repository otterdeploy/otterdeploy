import { useState } from "react";

import { createId, ID_PREFIX } from "@otterstack/shared/id";

import { serverCollection } from "@/features/servers/data/server";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Field, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DraftServer {
  name: string;
  host: string;
  region: string;
  role: "manager" | "worker";
  cpuTotal: string;
  memTotalGb: string;
  diskTotalGb: string;
  daemonVersion: string;
}

const empty: DraftServer = {
  name: "",
  host: "",
  region: "",
  role: "worker",
  cpuTotal: "",
  memTotalGb: "",
  diskTotalGb: "",
  daemonVersion: "",
};

export function ServerCreateDialog({ open, onOpenChange }: Props) {
  const [draft, setDraft] = useState<DraftServer>(empty);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cpu = Number.parseInt(draft.cpuTotal, 10);
  const mem = Number.parseInt(draft.memTotalGb, 10);
  const disk = draft.diskTotalGb ? Number.parseInt(draft.diskTotalGb, 10) : null;

  const canSubmit =
    !submitting &&
    draft.name.trim().length > 0 &&
    draft.host.trim().length > 0 &&
    draft.region.trim().length > 0 &&
    Number.isFinite(cpu) &&
    cpu > 0 &&
    Number.isFinite(mem) &&
    mem > 0;

  const set = <K extends keyof DraftServer>(key: K, value: DraftServer[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const reset = () => {
    setDraft(empty);
    setError(null);
    setSubmitting(false);
  };

  const handleClose = (next: boolean) => {
    onOpenChange(next);
    if (!next) reset();
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const id = createId(ID_PREFIX.server);
      serverCollection.insert({
        id,
        organizationId: "" as never, // server-side derives from active org
        name: draft.name.trim(),
        host: draft.host.trim(),
        region: draft.region.trim(),
        role: draft.role,
        status: "ready",
        availability: "active",
        cpuTotal: cpu,
        memTotalGb: mem,
        diskTotalGb: disk,
        diskUnit: "GB",
        daemonVersion: draft.daemonVersion.trim() || null,
        labels: [],
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      handleClose(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add server");
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add server</DialogTitle>
          <DialogDescription>
            Register a host that's joined to the Docker Swarm cluster. Capacity
            values are what the orchestrator will be allowed to schedule against.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2.5">
            <Field>
              <FieldLabel htmlFor="srv-name">Name</FieldLabel>
              <Input
                id="srv-name"
                autoFocus
                placeholder="helio-prod-04"
                className="font-mono"
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="srv-region">Region</FieldLabel>
              <Input
                id="srv-region"
                placeholder="sfo"
                className="font-mono"
                value={draft.region}
                onChange={(e) => set("region", e.target.value)}
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="srv-host">Host</FieldLabel>
            <Input
              id="srv-host"
              placeholder="10.0.4.14"
              className="font-mono"
              value={draft.host}
              onChange={(e) => set("host", e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-2.5">
            <Field>
              <FieldLabel htmlFor="srv-role">Role</FieldLabel>
              <Select
                value={draft.role}
                onValueChange={(v) => {
                  if (v === "manager" || v === "worker") set("role", v);
                }}
                items={[
                  { label: "Worker", value: "worker" },
                  { label: "Manager", value: "manager" },
                ]}
              >
                <SelectTrigger id="srv-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="worker">Worker</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="srv-daemon">Daemon version</FieldLabel>
              <Input
                id="srv-daemon"
                placeholder="26.1.4"
                className="font-mono"
                value={draft.daemonVersion}
                onChange={(e) => set("daemonVersion", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <Field>
              <FieldLabel htmlFor="srv-cpu">vCPU</FieldLabel>
              <Input
                id="srv-cpu"
                type="number"
                min={1}
                placeholder="16"
                className="font-mono"
                value={draft.cpuTotal}
                onChange={(e) => set("cpuTotal", e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="srv-mem">Memory (GB)</FieldLabel>
              <Input
                id="srv-mem"
                type="number"
                min={1}
                placeholder="32"
                className="font-mono"
                value={draft.memTotalGb}
                onChange={(e) => set("memTotalGb", e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="srv-disk">Disk (GB)</FieldLabel>
              <Input
                id="srv-disk"
                type="number"
                min={1}
                placeholder="500"
                className="font-mono"
                value={draft.diskTotalGb}
                onChange={(e) => set("diskTotalGb", e.target.value)}
              />
            </Field>
          </div>

          {error && <div className="text-sm text-destructive">{error}</div>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {submitting ? "Adding…" : "Add server"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
