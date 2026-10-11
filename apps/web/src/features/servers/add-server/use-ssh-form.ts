/**
 * The SSH form's state and submit: provision the server with the chosen key,
 * or with a password used once. Split from ./ssh-form to keep that file to its
 * fields.
 */

import type { ServerId } from "@otterdeploy/shared/id";

import { useState } from "react";

import { ORPCError } from "@orpc/client";
import { useForm } from "@tanstack/react-form";
import { Result } from "better-result";

import type { SshKey } from "@/features/ssh-keys/data/ssh-keys";

import { orpc, queryClient } from "@/shared/server/orpc";

/** The Select value that means "sign in with a password this once". */
export const PASSWORD = "password";

export const SSH_FORM_ID = "add-server-ssh";

/** Non-secret fields carried over when re-adding a failed server. */
export interface SshInitialValues {
  host: string;
  sshPort: string;
  sshUser: string;
  controlPlane: boolean;
}

export const BLANK: SshInitialValues = {
  host: "",
  sshPort: "22",
  sshUser: "root",
  controlPlane: false,
};

/** A failed start, as the line under the form. */
export function provisionErrorText(error: unknown): string {
  if (error instanceof ORPCError && error.code === "CONFLICT") {
    return "A server with this address has already been added.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Couldn't start the install. Try again.";
}

/** The port as a number, or null when it is not one a server can listen on. */
export function parsePort(value: string): number | null {
  const port = Number(value.trim());
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

export function useSshForm(
  initial: SshInitialValues,
  usableKeys: SshKey[],
  onStarted: (id: ServerId) => void,
) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: { ...initial, credential: "", password: "" },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      const key = usableKeys.find((k) => k.id === (value.credential || usableKeys[0]?.id));
      const host = value.host.trim();
      const started = await Result.tryPromise({
        try: () =>
          orpc.server.provision.call({
            // Named by its address until it reports a hostname.
            name: host,
            host,
            sshUser: value.sshUser.trim() || "root",
            sshPort: parsePort(value.sshPort) ?? 22,
            role: value.controlPlane ? "manager" : "worker",
            sshKeyId: key?.id,
            password: key ? undefined : value.password,
          }),
        catch: (cause) => cause,
      });
      if (Result.isError(started)) {
        setSubmitError(provisionErrorText(started.error));
        return;
      }
      void queryClient.invalidateQueries({ queryKey: orpc.server.list.queryKey() });
      onStarted(started.value.id);
    },
  });
  return { form, submitError };
}

export type SshFormApi = ReturnType<typeof useSshForm>["form"];
