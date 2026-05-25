import { useState } from "react";

import { Copy01Icon, InformationCircleIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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

// TODO: pull from the active org's manager endpoint + a real swarm.joinToken
// procedure once that lands in packages/api. For now these are placeholders
// the user is meant to recognise and replace.
const MANAGER_HOST = "manager.helio.so:2377";
const JOIN_TOKEN = "SWMTKN-1-replace-with-real-token-from-manager";

export function ServerCreateDialog({ open, onOpenChange }: Props) {
  const [mode, setMode] = useState<"join" | "manual">("join");

  const handleClose = (next: boolean) => {
    onOpenChange(next);
    if (!next) setMode("join");
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add server</DialogTitle>
          <DialogDescription>
            {mode === "join"
              ? "Join a host to the swarm. Once the daemon connects, it'll register itself in the list automatically."
              : "Record a host that's already joined the swarm but isn't appearing in the list."}
          </DialogDescription>
        </DialogHeader>

        {mode === "join" ? (
          <JoinInstructions onSwitchToManual={() => setMode("manual")} onDone={() => handleClose(false)} />
        ) : (
          <ManualRegisterForm
            onCancel={() => handleClose(false)}
            onSwitchToJoin={() => setMode("join")}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function JoinInstructions({
  onSwitchToManual,
  onDone,
}: {
  onSwitchToManual: () => void;
  onDone: () => void;
}) {
  const command = `docker swarm join --token ${JOIN_TOKEN} ${MANAGER_HOST}`;
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <>
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            1. Run on the new host
          </div>
          <div className="relative rounded-md border bg-muted/50 p-3 pr-12 font-mono text-[12px] leading-relaxed text-foreground/90">
            <code className="block break-all whitespace-pre-wrap">{command}</code>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={copy}
              aria-label={copied ? "Copied" : "Copy command"}
              className="absolute top-1.5 right-1.5"
            >
              <HugeiconsIcon
                icon={copied ? Tick02Icon : Copy01Icon}
                strokeWidth={2}
                className={copied ? "size-3.5 text-success" : "size-3.5"}
              />
            </Button>
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            2. Wait for the daemon to connect
          </div>
          <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/20 p-3 text-[12px] text-muted-foreground">
            <HugeiconsIcon
              icon={InformationCircleIcon}
              strokeWidth={2}
              className="mt-0.5 size-3.5 shrink-0 text-info"
            />
            <div className="flex flex-col gap-1">
              <span>
                The host will appear in the list within a few seconds of running the command. It
                self-reports its CPU, memory, and disk to the manager — nothing to fill in here.
              </span>
              <span className="text-muted-foreground/70">
                Ports needed on the new host: <span className="font-mono">2377/tcp</span> (control
                plane), <span className="font-mono">7946/tcp+udp</span> (gossip),{" "}
                <span className="font-mono">4789/udp</span> (overlay).
              </span>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter className="flex-row items-center sm:justify-between">
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-7 px-0 text-xs text-muted-foreground"
          onClick={onSwitchToManual}
        >
          Already joined? Register manually →
        </Button>
        <Button type="button" size="sm" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
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

const emptyDraft: DraftServer = {
  name: "",
  host: "",
  region: "",
  role: "worker",
  cpuTotal: "",
  memTotalGb: "",
  diskTotalGb: "",
  daemonVersion: "",
};

function ManualRegisterForm({
  onCancel,
  onSwitchToJoin,
}: {
  onCancel: () => void;
  onSwitchToJoin: () => void;
}) {
  const [draft, setDraft] = useState<DraftServer>(emptyDraft);
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
      onCancel();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add server");
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2.5">
          <Field>
            <FieldLabel htmlFor="srv-name">Hostname</FieldLabel>
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
          <FieldLabel htmlFor="srv-host">Advertise address</FieldLabel>
          <Input
            id="srv-host"
            placeholder="10.0.4.14"
            className="font-mono"
            value={draft.host}
            onChange={(e) => set("host", e.target.value)}
          />
          <div className="mt-1 text-[11px] text-muted-foreground">
            The IP this node advertises to other swarm members (what the daemon reports as its
            address, not the manager's).
          </div>
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

      <DialogFooter className="flex-row items-center sm:justify-between">
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-7 px-0 text-xs text-muted-foreground"
          onClick={onSwitchToJoin}
        >
          ← Use the join command instead
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-8" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" className="h-8" onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {submitting ? "Adding…" : "Register server"}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
