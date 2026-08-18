/**
 * Field components + submit plumbing for the create-network dialog. Split
 * from create-network-dialog.tsx so both files stay under the line/function
 * caps; the dialog owns the state, these render slices of it.
 */
import { type ReactNode } from "react";

import { ORPCError } from "@orpc/client";
import { toast } from "sonner";

import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Switch } from "@/shared/components/ui/switch";
import { orpc, queryClient } from "@/shared/server/orpc";

export interface CreateNetworkFormValues {
  name: string;
  driver: "bridge" | "overlay";
  attachable: boolean;
  internal: boolean;
  enableIPv6: boolean;
  /** Raw text: parsed/validated by parseMtu. */
  mtu: string;
  subnet: string;
  gateway: string;
  ipRange: string;
  labels: Array<{ key: string; value: string }>;
}

export interface FieldsProps {
  values: CreateNetworkFormValues;
  patch: (p: Partial<CreateNetworkFormValues>) => void;
}

// Mirrors the contract's networkNameField.
export const NETWORK_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export function parseMtu(raw: string): { value: number | undefined; valid: boolean } {
  if (raw.trim() === "") return { value: undefined, valid: true };
  const n = Number(raw);
  const valid = Number.isInteger(n) && n >= 68 && n <= 65535;
  return { value: valid ? n : undefined, valid };
}

/** Gateway/IP-range only mean something inside a subnet. */
export function ipamNeedsSubnet(v: CreateNetworkFormValues): boolean {
  return v.subnet.trim() === "" && (v.gateway.trim() !== "" || v.ipRange.trim() !== "");
}

type CreateNetworkPayload = Parameters<typeof orpc.docker.networks.create.call>[0];

function buildPayload(v: CreateNetworkFormValues): CreateNetworkPayload {
  const labels: Record<string, string> = {};
  for (const row of v.labels) {
    if (row.key.trim()) labels[row.key.trim()] = row.value;
  }
  const mtu = parseMtu(v.mtu).value;
  const pool = {
    ...(v.subnet.trim() ? { subnet: v.subnet.trim() } : {}),
    ...(v.gateway.trim() ? { gateway: v.gateway.trim() } : {}),
    ...(v.ipRange.trim() ? { ipRange: v.ipRange.trim() } : {}),
  };
  return {
    name: v.name,
    driver: v.driver,
    attachable: v.attachable,
    ...(v.internal ? { internal: true } : {}),
    ...(v.enableIPv6 ? { enableIPv6: true } : {}),
    ...(mtu !== undefined ? { mtu } : {}),
    ...(Object.keys(pool).length > 0 ? { ipam: [pool] } : {}),
    ...(Object.keys(labels).length > 0 ? { labels } : {}),
  };
}

/** Create the network + refresh the inventory; toasts either way. Returns
 *  whether the dialog should close. */
export async function submitCreateNetwork(values: CreateNetworkFormValues): Promise<boolean> {
  try {
    const created = await orpc.docker.networks.create.call(buildPayload(values));
    void queryClient.invalidateQueries({
      queryKey: orpc.docker.networks.list.queryKey({ input: {} }),
    });
    toast.success(
      created.warning
        ? `Network ${values.name} created: ${created.warning}`
        : `Network ${values.name} created`,
    );
    return true;
  } catch (err) {
    if (err instanceof ORPCError && err.code === "CONFLICT") {
      toast.error(`A network named ${values.name} already exists`);
    } else {
      toast.error(err instanceof Error ? err.message : "Couldn't create the network");
    }
    return false;
  }
}

export function DialogField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col">
        <span className="text-xs">{label}</span>
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

const DRIVERS = [
  { value: "bridge", label: "bridge: plain-docker containers" },
  { value: "overlay", label: "overlay: swarm services" },
];

export function DriverField({ values, patch }: FieldsProps) {
  return (
    <DialogField label="Driver">
      <Select
        items={DRIVERS}
        value={values.driver}
        onValueChange={(v) => {
          if (v === "bridge" || v === "overlay") patch({ driver: v });
        }}
      >
        <SelectTrigger className="font-mono">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DRIVERS.map((d) => (
            <SelectItem key={d.value} value={d.value} className="py-1.5 pl-2 font-mono">
              {d.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </DialogField>
  );
}

export function FlagFields({ values, patch }: FieldsProps) {
  return (
    <>
      <SwitchRow
        label="Attachable"
        hint="Required for services to join this network."
        checked={values.attachable}
        onChange={(v) => patch({ attachable: v })}
      />
      <SwitchRow
        label="Internal"
        hint="No outbound route: members only see each other."
        checked={values.internal}
        onChange={(v) => patch({ internal: v })}
      />
      <SwitchRow
        label="IPv6"
        hint="Also allocate an IPv6 subnet."
        checked={values.enableIPv6}
        onChange={(v) => patch({ enableIPv6: v })}
      />
    </>
  );
}

export function IpamFields({ values, patch }: FieldsProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">IPAM (optional)</span>
      <div className="grid grid-cols-3 gap-1.5">
        <Input
          className="h-8 font-mono text-xs"
          placeholder="10.10.0.0/16"
          aria-label="Subnet"
          value={values.subnet}
          onChange={(e) => patch({ subnet: e.target.value })}
        />
        <Input
          className="h-8 font-mono text-xs"
          placeholder="gateway"
          aria-label="Gateway"
          value={values.gateway}
          onChange={(e) => patch({ gateway: e.target.value })}
        />
        <Input
          className="h-8 font-mono text-xs"
          placeholder="ip range"
          aria-label="IP range"
          value={values.ipRange}
          onChange={(e) => patch({ ipRange: e.target.value })}
        />
      </div>
      {ipamNeedsSubnet(values) ? (
        <span className="text-xs text-destructive">Gateway/IP range require a subnet.</span>
      ) : null}
    </div>
  );
}
