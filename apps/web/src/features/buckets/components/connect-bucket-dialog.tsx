/**
 * Connect a bucket — in bucket language.
 *
 * Under the hood this creates an S3 backup destination, because a bucket IS
 * one: same bucket, same credential, stored once, browsable here and usable
 * as a backup target. But the person clicking "Connect a bucket" is thinking
 * about a bucket, so the dialog says bucket, offers only S3-compatible
 * fields, and verifies the connection right after creating it.
 */
import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { orpc } from "@/shared/server/orpc";

export function ConnectBucketDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new bucket's id after it exists, test or no test. */
  onConnected: (id: string) => void;
}) {
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ConnectBucketBody onClose={() => onOpenChange(false)} onConnected={onConnected} />
    </Dialog>
  );
}

interface FormState {
  name: string;
  bucket: string;
  region: string;
  endpoint: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const EMPTY: FormState = {
  name: "",
  bucket: "",
  region: "",
  endpoint: "",
  prefix: "",
  accessKeyId: "",
  secretAccessKey: "",
};

function ConnectBucketBody({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: (id: string) => void;
}) {
  const [form, setForm] = useState(EMPTY);
  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const create = useMutation(orpc.backups.destinations.create.mutationOptions());
  const test = useMutation(orpc.backups.destinations.test.mutationOptions());

  const incomplete =
    form.bucket.trim() === "" ||
    form.accessKeyId.trim() === "" ||
    form.secretAccessKey.trim() === "";
  const busy = create.isPending || test.isPending;

  const submit = () => {
    const config: Record<string, string> = { bucket: form.bucket.trim() };
    if (form.region.trim() !== "") config.region = form.region.trim();
    if (form.endpoint.trim() !== "") config.endpoint = form.endpoint.trim();
    if (form.prefix.trim() !== "") config.prefix = form.prefix.trim();

    create.mutate(
      {
        name: form.name.trim() === "" ? form.bucket.trim() : form.name.trim(),
        type: "s3",
        config,
        secret: {
          accessKeyId: form.accessKeyId.trim(),
          secretAccessKey: form.secretAccessKey.trim(),
        },
      },
      {
        onSuccess: (created) => {
          // The bucket exists either way; the test only decides the toast.
          onConnected(created.id);
          test.mutate(
            { id: created.id },
            {
              onSuccess: () => {
                toast.success(`Connected ${created.name}`);
                onClose();
              },
              onError: (err) => {
                toast.warning(
                  `Connected, but the bucket didn't answer: ${
                    err instanceof Error ? err.message : "test failed"
                  }`,
                );
                onClose();
              },
            },
          );
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Couldn't connect the bucket."),
      },
    );
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Connect a bucket</DialogTitle>
        <DialogDescription>
          Any S3-compatible bucket — AWS, R2, MinIO, Spaces. The credential is encrypted at rest,
          never leaves the control plane, and also makes this bucket available as a backup
          destination.
        </DialogDescription>
      </DialogHeader>

      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!incomplete && !busy) submit();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <LabeledInput
            label="Bucket"
            value={form.bucket}
            onChange={set("bucket")}
            placeholder="acme-uploads"
          />
          <LabeledInput
            label="Region"
            value={form.region}
            onChange={set("region")}
            placeholder="us-east-1"
            optional
          />
        </div>
        <LabeledInput
          label="Endpoint"
          value={form.endpoint}
          onChange={set("endpoint")}
          placeholder="https://… — empty for AWS"
          optional
        />
        <div className="grid grid-cols-2 gap-3">
          <LabeledInput
            label="Prefix"
            value={form.prefix}
            onChange={set("prefix")}
            placeholder="uploads/"
            optional
          />
          <LabeledInput
            label="Display name"
            value={form.name}
            onChange={set("name")}
            placeholder="defaults to the bucket"
            optional
          />
        </div>
        <LabeledInput
          label="Access key ID"
          value={form.accessKeyId}
          onChange={set("accessKeyId")}
          mono
        />
        <LabeledInput
          label="Secret access key"
          value={form.secretAccessKey}
          onChange={set("secretAccessKey")}
          type="password"
          mono
        />

        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={incomplete || busy}>
            {create.isPending ? "Connecting…" : test.isPending ? "Verifying…" : "Connect bucket"}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

function LabeledInput({
  label,
  optional = false,
  mono = false,
  ...props
}: React.ComponentProps<typeof Input> & {
  label: string;
  optional?: boolean;
  mono?: boolean;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[12px] font-medium text-foreground/80">
        {label}
        {optional ? <span className="ml-1 text-muted-foreground">optional</span> : null}
      </span>
      <Input {...props} className={mono ? "font-mono text-[12.5px]" : undefined} />
    </label>
  );
}
