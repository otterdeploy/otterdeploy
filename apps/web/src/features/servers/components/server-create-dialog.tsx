import { useState } from "react";

import { createId, ID_PREFIX } from "@otterstack/shared/id";

import { serverCollection } from "@/features/servers/data/server";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
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

import {
  JoinTokenPanel,
  MANAGER_ADDR,
  type JoinRole,
} from "./join-token-panel";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ServerCreateDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add server to swarm</DialogTitle>
        </DialogHeader>
        <JoinForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function JoinForm({ onDone }: { onDone: () => void }) {
  const [role, setRole] = useState<JoinRole>("worker");
  const [hostname, setHostname] = useState("");
  const [privateIp, setPrivateIp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    !submitting && hostname.trim().length > 0 && privateIp.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const id = createId(ID_PREFIX.server);
      serverCollection.insert({
        id,
        organizationId: "" as never, // server-side derives from active org
        name: hostname.trim(),
        hostname: hostname.trim(),
        host: privateIp.trim(),
        region: null,
        role,
        status: "ready",
        availability: "active",
        cpuTotal: 0,
        memTotalGb: 0,
        diskTotalGb: null,
        diskUnit: "GB",
        daemonVersion: null,
        labels: [],
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to register server");
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">1.</span> SSH into the new host,
            install Docker, then run the join command below. The node will register with the
            swarm manager at{" "}
            <code className="rounded-sm bg-muted px-1 py-px font-mono text-[12px] text-foreground">
              {MANAGER_ADDR}
            </code>
            .
          </p>
          <JoinTokenPanel role={role} onRoleChange={setRole} />
        </section>

        <div className="border-t" />

        <section className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">2.</span> After the daemon reports
            back, fill in the metadata so it shows up in the right rotation.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="srv-hostname">Hostname</FieldLabel>
              <Input
                id="srv-hostname"
                autoFocus
                placeholder="helio-prod-04"
                className="font-mono"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="srv-ip">Private IP</FieldLabel>
              <Input
                id="srv-ip"
                placeholder="10.0.4.14"
                className="font-mono"
                value={privateIp}
                onChange={(e) => setPrivateIp(e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="srv-role">Role</FieldLabel>
              <Select
                value={role}
                onValueChange={(v) => {
                  if (v === "worker" || v === "manager") setRole(v);
                }}
                items={[
                  { label: "worker", value: "worker" },
                  { label: "manager (raft quorum)", value: "manager" },
                ]}
              >
                <SelectTrigger id="srv-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="worker">worker</SelectItem>
                  <SelectItem value="manager">manager (raft quorum)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          {error && <div className="text-sm text-destructive">{error}</div>}
        </section>
      </div>

      <DialogFooter className="flex-row items-center sm:justify-between">
        <span className="text-[12px] text-muted-foreground">
          Otterstack will retry SSH every 10s until the daemon answers.
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-8" onClick={onDone} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" className="h-8" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? "Registering…" : "+ Register node"}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
