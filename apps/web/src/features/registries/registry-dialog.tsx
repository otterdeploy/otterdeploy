/**
 * Add / edit dialog for a container registry credential.
 *
 * Same component for both flows — when `existing` is set we PATCH and
 * the password field is optional (blank = leave existing in place); when
 * it's null we POST and password is required. The host field is locked
 * after creation because changing it would semantically be "this is now
 * a different registry" — operators should delete and re-add.
 */

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

import { HOST_PRESETS, type RegistryView } from "./shared";

interface RegistryDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existing: RegistryView | null;
}

export function RegistryDialog({
  open,
  onOpenChange,
  existing,
}: RegistryDialogProps) {
  const [displayName, setDisplayName] = useState("");
  const [host, setHost] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Reset / hydrate when the dialog opens or the row being edited changes.
  useEffect(() => {
    if (!open) return;
    if (existing) {
      setDisplayName(existing.displayName);
      setHost(existing.host);
      setUsername(existing.username);
      setPassword("");
    } else {
      setDisplayName("");
      setHost("");
      setUsername("");
      setPassword("");
    }
  }, [open, existing]);

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.registry.list.queryKey({ input: undefined }),
    });

  const createMut = useMutation({
    ...orpc.registry.create.mutationOptions(),
    onSuccess: () => {
      toast.success("Registry credential added");
      void invalidate();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message ?? "Failed to add registry"),
  });

  const updateMut = useMutation({
    ...orpc.registry.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Registry credential updated");
      void invalidate();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message ?? "Failed to update registry"),
  });

  const pending = createMut.isPending || updateMut.isPending;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (existing) {
      updateMut.mutate({
        id: existing.id as never,
        displayName: displayName.trim(),
        username: username.trim(),
        password,
      });
    } else {
      createMut.mutate({
        displayName: displayName.trim(),
        host: host.trim(),
        username: username.trim(),
        password,
        authType: "password",
      });
    }
  };

  const isEdit = existing !== null;
  const canSubmit =
    displayName.trim().length > 0 &&
    host.trim().length > 0 &&
    username.trim().length > 0 &&
    (isEdit || password.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit registry credential" : "Add registry credential"}
          </DialogTitle>
        </DialogHeader>
        <RegistryFormFields
          displayName={displayName}
          host={host}
          username={username}
          password={password}
          isEdit={isEdit}
          onDisplayNameChange={setDisplayName}
          onHostChange={setHost}
          onUsernameChange={setUsername}
          onPasswordChange={setPassword}
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
          canSubmit={canSubmit}
          pending={pending}
        />
      </DialogContent>
    </Dialog>
  );
}

interface FormFieldsProps {
  displayName: string;
  host: string;
  username: string;
  password: string;
  isEdit: boolean;
  onDisplayNameChange: (v: string) => void;
  onHostChange: (v: string) => void;
  onUsernameChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  canSubmit: boolean;
  pending: boolean;
}

function RegistryFormFields(props: FormFieldsProps) {
  return (
    <form onSubmit={props.onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reg-display">Display name</Label>
        <Input
          id="reg-display"
          value={props.displayName}
          onChange={(e) => props.onDisplayNameChange(e.target.value)}
          placeholder="GHCR (ci-bot)"
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reg-host">Registry host</Label>
        <Input
          id="reg-host"
          value={props.host}
          onChange={(e) => props.onHostChange(e.target.value)}
          placeholder="ghcr.io"
          disabled={props.isEdit}
          className="font-mono"
        />
        {!props.isEdit && (
          <div className="flex flex-wrap gap-1.5">
            {HOST_PRESETS.map((h) => (
              <button
                key={h.value}
                type="button"
                title={h.label}
                onClick={() => props.onHostChange(h.value)}
                className={cn(
                  "rounded-md border px-2 py-1 font-mono text-[11px] transition-colors",
                  props.host === h.value
                    ? "border-foreground bg-accent text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
              >
                {h.value}
              </button>
            ))}
          </div>
        )}
        {props.isEdit && (
          <p className="text-[11px] text-muted-foreground">
            Host is locked. To use a different one, delete this credential
            and add a new one.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reg-username">Username</Label>
        <Input
          id="reg-username"
          value={props.username}
          onChange={(e) => props.onUsernameChange(e.target.value)}
          placeholder="ci-bot"
          autoComplete="off"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reg-password">
          {props.isEdit ? "New password / token (optional)" : "Password / token"}
        </Label>
        <Input
          id="reg-password"
          type="password"
          value={props.password}
          onChange={(e) => props.onPasswordChange(e.target.value)}
          placeholder={props.isEdit ? "Leave blank to keep current" : ""}
          autoComplete="new-password"
        />
        <p className="text-[11px] text-muted-foreground">
          Stored encrypted (AES-GCM, key derived from the auth secret).
        </p>
      </div>

      <DialogFooter className="mt-2">
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={props.onCancel}
          disabled={props.pending}
        >
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={!props.canSubmit || props.pending}>
          {props.pending ? "Saving…" : props.isEdit ? "Save changes" : "Add registry"}
        </Button>
      </DialogFooter>
    </form>
  );
}
