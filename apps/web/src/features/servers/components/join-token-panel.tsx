import { useMemo, useState } from "react";

import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/shared/components/ui/toggle-group";
import { orpc, queryClient } from "@/shared/server/orpc";

import { JoinCommandBlock } from "./join-command-block";

export type JoinRole = "worker" | "manager";

interface JoinTokenPanelProps {
  role: JoinRole;
  onRoleChange: (role: JoinRole) => void;
}

interface EnrollmentSummary {
  id: string;
  role: JoinRole;
  status: "active" | "expired" | "redeemed" | "completed" | "revoked";
}

interface StepUpFormProps {
  role: JoinRole;
  totpCode: string;
  managerConfirmation: string;
  canSubmit: boolean;
  creating: boolean;
  rotating: boolean;
  onTotpCodeChange: (value: string) => void;
  onManagerConfirmationChange: (value: string) => void;
  onCreate: () => void;
  onRotate: () => void;
}

function StepUpForm(props: StepUpFormProps) {
  return (
    <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
      <label htmlFor="node-enrollment-totp" className="grid gap-1.5">
        <span className="text-xs font-medium">Authenticator code</span>
        <Input
          id="node-enrollment-totp"
          value={props.totpCode}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          placeholder="000000"
          className="max-w-40 font-mono"
          onChange={(event) => props.onTotpCodeChange(event.target.value.replace(/\D/g, ""))}
        />
      </label>
      {props.role === "manager" ? (
        <label htmlFor="node-enrollment-manager-confirmation" className="grid gap-1.5">
          <span className="text-xs font-medium">Confirm manager authority</span>
          <Input
            id="node-enrollment-manager-confirmation"
            value={props.managerConfirmation}
            placeholder="ENROLL MANAGER"
            className="font-mono"
            onChange={(event) => props.onManagerConfirmationChange(event.target.value)}
          />
          <span className="text-[11px] text-muted-foreground">
            Managers participate in cluster quorum and can control every workload.
          </span>
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!props.canSubmit || props.creating} onClick={props.onCreate}>
          {props.creating ? "Creating…" : "Create 10-minute enrollment"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!props.canSubmit || props.rotating}
          onClick={props.onRotate}
        >
          {props.rotating ? "Rotating…" : `Rotate ${props.role} credential`}
        </Button>
      </div>
    </div>
  );
}

function EnrollmentHistory({
  enrollments,
  revoking,
  onRevoke,
}: {
  enrollments: EnrollmentSummary[];
  revoking: boolean;
  onRevoke: (id: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <span className="text-xs font-medium">Recent enrollment credentials</span>
      {enrollments.length === 0 ? (
        <p className="text-xs text-muted-foreground">No enrollment credentials created.</p>
      ) : (
        <div className="divide-y rounded-md border">
          {enrollments.map((enrollment) => (
            <div key={enrollment.id} className="flex items-center gap-2 px-3 py-2 text-xs">
              <Badge variant="secondary">{enrollment.role}</Badge>
              <code className="min-w-0 flex-1 truncate text-muted-foreground">{enrollment.id}</code>
              <span className="text-muted-foreground">{enrollment.status}</span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Revoke ${enrollment.id}`}
                disabled={
                  revoking || enrollment.status === "revoked" || enrollment.status === "completed"
                }
                onClick={() => onRevoke(enrollment.id)}
              >
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function JoinTokenPanel({ role, onRoleChange }: JoinTokenPanelProps) {
  const [totpCode, setTotpCode] = useState("");
  const [managerConfirmation, setManagerConfirmation] = useState("");
  const [created, setCreated] = useState<{
    id: string;
    credential: string;
    expiresAt: string;
  } | null>(null);

  const enrollments = useQuery({
    ...orpc.server.enrollments.queryOptions(),
    refetchInterval: 5000,
  });
  const create = useMutation(
    orpc.server.createEnrollment.mutationOptions({
      onSuccess: (value) => {
        setCreated(value);
        setTotpCode("");
        void queryClient.invalidateQueries({ queryKey: orpc.server.enrollments.queryKey() });
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const revoke = useMutation(
    orpc.server.revokeEnrollment.mutationOptions({
      onSuccess: (_value, variables) => {
        toast.success("Enrollment revoked");
        setCreated((current) => (current?.id === variables.id ? null : current));
        void queryClient.invalidateQueries({ queryKey: orpc.server.enrollments.queryKey() });
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const rotate = useMutation(
    orpc.server.rotateJoinCredential.mutationOptions({
      onSuccess: () => {
        toast.success(`${role === "manager" ? "Manager" : "Worker"} join credential rotated`);
        setTotpCode("");
        setCreated(null);
        void queryClient.invalidateQueries({ queryKey: orpc.server.enrollments.queryKey() });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const command = useMemo(() => {
    if (!created) return null;
    const url = `${window.location.origin}/api/node-enrollments/${created.id}/redeem`;
    return `( set -e; script="$(curl -fsS -X POST '${url}' -H 'Authorization: Bearer ${created.credential}')"; printf '%s\\n' "$script" | sudo sh )`;
  }, [created]);

  const stepUpInput = {
    role,
    totpCode,
    managerConfirmation: role === "manager" ? managerConfirmation : undefined,
  };
  const canSubmit =
    /^\d{6}(\d{2})?$/.test(totpCode) &&
    (role !== "manager" || managerConfirmation === "ENROLL MANAGER");

  return (
    <div className="flex flex-col gap-4">
      <ToggleGroup
        value={[role]}
        onValueChange={(next) => {
          const value = next[0];
          if (value === "worker" || value === "manager") {
            onRoleChange(value);
            setCreated(null);
          }
        }}
        className="self-start"
      >
        <ToggleGroupItem value="worker" aria-label="Worker enrollment">
          Worker
        </ToggleGroupItem>
        <ToggleGroupItem value="manager" aria-label="Manager enrollment">
          Manager
        </ToggleGroupItem>
      </ToggleGroup>

      <StepUpForm
        role={role}
        totpCode={totpCode}
        managerConfirmation={managerConfirmation}
        canSubmit={canSubmit}
        creating={create.isPending}
        rotating={rotate.isPending}
        onTotpCodeChange={setTotpCode}
        onManagerConfirmationChange={setManagerConfirmation}
        onCreate={() => create.mutate({ ...stepUpInput, ttlMinutes: 10 })}
        onRotate={() => rotate.mutate(stepUpInput)}
      />

      {command && created ? (
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">
            Shown once. It expires {new Date(created.expiresAt).toLocaleTimeString()} and can enroll
            one {role}. Completion rotates Docker&apos;s underlying {role} token.
          </p>
          <JoinCommandBlock command={command} />
        </div>
      ) : null}

      <EnrollmentHistory
        enrollments={enrollments.data ?? []}
        revoking={revoke.isPending}
        onRevoke={(id) => revoke.mutate({ id })}
      />
    </div>
  );
}
