/**
 * Create a docker network from the Raw Docker panel. Driver defaults to the
 * one the active runtime can actually use (overlay under swarm, bridge under
 * plain docker); attachable defaults ON because an unattachable network can't
 * serve the per-service extra-networks feature. IPAM is one optional pool -
 * the daemon auto-allocates a subnet when it's left blank.
 *
 * Controlled state, not tanstack-form: the field slices live in
 * ./create-network-fields.tsx (line caps), and plain `{ values, patch }`
 * props cross that boundary without form-generic plumbing.
 */
import { useState } from "react";

import { LabelsEditor } from "@/features/volumes/create-volume-dialog";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";

import {
  DialogField,
  DriverField,
  FlagFields,
  IpamFields,
  ipamNeedsSubnet,
  NETWORK_NAME_RE,
  parseMtu,
  submitCreateNetwork,
  type CreateNetworkFormValues,
} from "./create-network-fields";

export function CreateNetworkDialog({
  open,
  onOpenChange,
  swarm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Drives the default driver: services can only join networks whose
   *  driver matches the active runtime. */
  swarm: boolean;
}) {
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <CreateNetworkBody swarm={swarm} onClose={() => onOpenChange(false)} />
    </Dialog>
  );
}

function initialValues(swarm: boolean): CreateNetworkFormValues {
  return {
    name: "",
    driver: swarm ? "overlay" : "bridge",
    attachable: true,
    internal: false,
    enableIPv6: false,
    mtu: "",
    subnet: "",
    gateway: "",
    ipRange: "",
    labels: [],
  };
}

function CreateNetworkBody({ swarm, onClose }: { swarm: boolean; onClose: () => void }) {
  const [values, setValues] = useState(() => initialValues(swarm));
  const [submitting, setSubmitting] = useState(false);
  const patch = (p: Partial<CreateNetworkFormValues>) => setValues((v) => ({ ...v, ...p }));

  const nameInvalid = values.name.length > 0 && !NETWORK_NAME_RE.test(values.name);
  const mtuInvalid = !parseMtu(values.mtu).valid;
  const valid = NETWORK_NAME_RE.test(values.name) && !mtuInvalid && !ipamNeedsSubnet(values);

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    const done = await submitCreateNetwork(values);
    setSubmitting(false);
    if (done) onClose();
  };

  return (
    <DialogContent className="gap-0 [--dlg-pad:0px] p-0 sm:max-w-lg">
      <DialogHeader className="border-b px-5 py-3">
        <DialogTitle className="text-sm font-semibold">Create network</DialogTitle>
        <p className="text-xs text-muted-foreground">
          A docker network on this daemon. Services can join it from their Settings tab, in
          addition to their project network.
        </p>
      </DialogHeader>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        noValidate
      >
        <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto p-5">
          <DialogField label="Name">
            <Input
              className="font-mono"
              placeholder="shared-mesh"
              value={values.name}
              autoFocus
              aria-invalid={nameInvalid || undefined}
              onChange={(e) => patch({ name: e.target.value })}
            />
            {nameInvalid ? (
              <span className="text-xs text-destructive">
                Lowercase; must start with a letter or digit; only letters, digits, `_`, `-` (max
                63 chars).
              </span>
            ) : null}
          </DialogField>

          <DriverField values={values} patch={patch} />
          <FlagFields values={values} patch={patch} />

          <DialogField label="MTU (optional)">
            <Input
              className="font-mono"
              placeholder="1500"
              inputMode="numeric"
              value={values.mtu}
              aria-invalid={mtuInvalid || undefined}
              onChange={(e) => patch({ mtu: e.target.value })}
            />
            {mtuInvalid ? (
              <span className="text-xs text-destructive">Whole number between 68 and 65535.</span>
            ) : null}
          </DialogField>

          <IpamFields values={values} patch={patch} />

          <LabelsEditor value={values.labels} onChange={(labels) => patch({ labels })} />
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-5 py-3">
          <span className="max-w-[55%] text-[11px] text-muted-foreground">
            Leave IPAM blank and docker allocates a subnet automatically.
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" type="submit" disabled={!valid || submitting}>
              {submitting ? "Creating…" : "Create network"}
            </Button>
          </div>
        </div>
      </form>
    </DialogContent>
  );
}
