import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { useForm, useStore } from "@tanstack/react-form";
import { toast } from "sonner";

import { serverCollection } from "@/features/servers/data/server";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
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
  ManagerAddressChip,
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
  const form = useForm({
    defaultValues: {
      role: "worker" as JoinRole,
      hostname: "",
      privateIp: "",
    },
    onSubmit: ({ value }) => {
      const id = createId(ID_PREFIX.server);

      // Optimistic insert — close instantly; tx.isPersisted.promise rolls the
      // row back and surfaces the error on reject.
      const tx = serverCollection.insert({
        id,
        organizationId: "" as never, // server-side derives from active org
        name: value.hostname.trim(),
        hostname: value.hostname.trim(),
        host: value.privateIp.trim(),
        region: null,
        role: value.role,
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
      tx.isPersisted.promise.catch((err: unknown) =>
        toast.error(
          err instanceof Error ? err.message : "Failed to register server",
        ),
      );
    },
  });

  // Subscribe to role so the JoinTokenPanel (which mirrors the selected role
  // into its join command) re-renders on change.
  const role = useStore(form.store, (s) => s.values.role);
  const setRole = (next: JoinRole) => form.setFieldValue("role", next);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      noValidate
    >
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">1.</span> SSH into the new host,
            install Docker, then run the join command below. The node will register with the
            swarm manager at <ManagerAddressChip />.
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
            <form.Field
              name="hostname"
              validators={{
                onChange: ({ value }) =>
                  value.trim().length === 0 ? "Hostname is required" : undefined,
              }}
            >
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Hostname</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    autoFocus
                    placeholder="helio-prod-04"
                    className="font-mono"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  {field.state.meta.errors.map((err) => (
                    <FieldError key={String(err)}>{String(err)}</FieldError>
                  ))}
                </Field>
              )}
            </form.Field>
            <form.Field
              name="privateIp"
              validators={{
                onChange: ({ value }) =>
                  value.trim().length === 0 ? "Private IP is required" : undefined,
              }}
            >
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Private IP</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    placeholder="10.0.4.14"
                    className="font-mono"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  {field.state.meta.errors.map((err) => (
                    <FieldError key={String(err)}>{String(err)}</FieldError>
                  ))}
                </Field>
              )}
            </form.Field>
          </div>

          <RoleSelect role={role} onRoleChange={setRole} />
        </section>
      </div>

      <DialogFooter className="flex-row items-center sm:justify-between">
        <span className="text-[12px] text-muted-foreground">
          Otterdeploy will retry SSH every 10s until the daemon answers.
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            type="button"
            onClick={onDone}
          >
            Cancel
          </Button>
          <form.Subscribe selector={(s) => s.canSubmit}>
            {(canSubmit) => (
              <Button size="sm" className="h-8" type="submit" disabled={!canSubmit}>
                + Register node
              </Button>
            )}
          </form.Subscribe>
        </div>
      </DialogFooter>
    </form>
  );
}

/** Swarm role picker — plain (non-form) so it stays type-clean across the split. */
function RoleSelect({
  role,
  onRoleChange,
}: {
  role: JoinRole;
  onRoleChange: (next: JoinRole) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field>
        <FieldLabel htmlFor="srv-role">Role</FieldLabel>
        <Select
          value={role}
          onValueChange={(v) => {
            if (v === "worker" || v === "manager") onRoleChange(v);
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
  );
}
