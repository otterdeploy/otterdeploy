/**
 * The Command tab's state: confirm it's you, create a one-time command, then
 * watch the enrollment it made until the server connects or the command dies.
 *
 * Step-up asks for whichever credential the account actually has (an
 * authenticator code when 2FA is on, the password otherwise), the same choice
 * the server makes in `verifyStepUpCredential`. The command is always for a
 * server that runs workloads; a control plane is added over SSH.
 */

import { useState } from "react";

import { ORPCError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useControlPlaneBaseUrl } from "@/features/shell/hooks/use-control-plane-base-url";
import { sessionQuery } from "@/lib/auth-queries";
import { useNowTick } from "@/shared/lib/duration";
import { orpc, queryClient } from "@/shared/server/orpc";

import { commandPhase, type CommandPhase } from "../components/enrollment-progress";
import { buildJoinCommand, type CreatedCommand } from "./join-command";

/** `twoFactorEnabled` is a plugin field the base session user type doesn't
 *  declare, so it's read off the object structurally rather than asserted. */
function readTwoFactorEnabled(sessionUser: unknown): boolean {
  return Boolean(
    typeof sessionUser === "object" &&
    sessionUser !== null &&
    "twoFactorEnabled" in sessionUser &&
    sessionUser.twoFactorEnabled,
  );
}

/** What the field says when Create is pressed with nothing in it. */
function emptyCredentialText(twoFactor: boolean): string {
  return twoFactor
    ? "Enter the 6-digit code from your authenticator app."
    : "Enter your account password.";
}

/**
 * A failed create, as the line under the field. The wrong credential is the
 * common case and gets plain words; anything else keeps the server's message.
 */
export function stepUpErrorText(error: unknown, twoFactor: boolean): string {
  if (error instanceof ORPCError && error.code === "INVALID_STEP_UP") {
    return twoFactor
      ? "That code isn't right. Try again."
      : "That password isn't right. Try again.";
  }
  if (error instanceof ORPCError && error.code === "SWARM_UNAVAILABLE") {
    return "This control plane can't take new servers by command yet.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Couldn't create the command. Try again.";
}

function isCredentialReady(twoFactor: boolean, value: string): boolean {
  return twoFactor ? /^\d{6}(\d{2})?$/.test(value) : value.length > 0;
}

/** One `server.enrollments` row, with its branded id. */
export type EnrollmentRow = Awaited<ReturnType<typeof orpc.server.enrollments.call>>[number];

export function useCommandFlow() {
  const sessionQ = useQuery(sessionQuery);
  const twoFactor = readTwoFactorEnabled(sessionQ.data?.user);
  const [credential, setCredential] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedCommand | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const baseUrl = useControlPlaneBaseUrl();

  const enrollments = useQuery({
    ...orpc.server.enrollments.queryOptions(),
    refetchInterval: 5000,
  });
  const rows = enrollments.data ?? [];
  const row = created ? rows.find((r) => r.id === created.id) : undefined;
  const earlier = rows.filter((r) => r.id !== created?.id);

  const live = created !== null && !row?.completedAt && row?.status !== "revoked";
  const now = useNowTick(live);
  const phase: CommandPhase = commandPhase(created, row, now);

  const create = useMutation(
    orpc.server.createEnrollment.mutationOptions({
      onSuccess: (value) => {
        setCreated(value);
        setCredential("");
        setFieldError(null);
        void queryClient.invalidateQueries({ queryKey: orpc.server.enrollments.queryKey() });
      },
      onError: (error) => setFieldError(stepUpErrorText(error, twoFactor)),
    }),
  );
  const revoke = useMutation(
    orpc.server.revokeEnrollment.mutationOptions({
      onSuccess: (_value, variables) => {
        toast.success("Command revoked");
        setCreated((current) => (current?.id === variables.id ? null : current));
        void queryClient.invalidateQueries({ queryKey: orpc.server.enrollments.queryKey() });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return {
    phase,
    twoFactor,
    /** Held while the session loads: guessing would show the wrong field. */
    sessionPending: sessionQ.isPending,
    credential,
    fieldError,
    creating: create.isPending,
    created,
    row,
    now,
    command: created ? buildJoinCommand(baseUrl, created) : null,
    earlier,
    historyOpen,
    revoking: revoke.isPending,
    setCredential: (value: string) => {
      setCredential(twoFactor ? value.replace(/\D/g, "") : value);
      setFieldError(null);
    },
    submit: () => {
      if (!isCredentialReady(twoFactor, credential)) {
        setFieldError(emptyCredentialText(twoFactor));
        return;
      }
      create.mutate({
        role: "worker",
        totpCode: twoFactor ? credential : undefined,
        password: twoFactor ? undefined : credential,
        ttlMinutes: 10,
      });
    },
    /** Back to a fresh confirm step, for "New command" and "Add another". */
    startOver: () => setCreated(null),
    toggleHistory: () => setHistoryOpen((open) => !open),
    revoke: (id: EnrollmentRow["id"]) => revoke.mutate({ id }),
  };
}

export type CommandFlow = ReturnType<typeof useCommandFlow>;
