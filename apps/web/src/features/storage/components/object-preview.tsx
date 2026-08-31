/**
 * The preview pane for one object.
 *
 * Shows metadata and hands out a short-lived presigned URL on demand. The
 * control plane never proxies the bytes and the browser never holds a
 * credential — a presign is minted when you click, not when you select, so
 * merely looking at a row does not create a URL that could be shared.
 */
import { useState } from "react";

import { Cancel01Icon, Download01Icon, Link01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatBytes } from "@otterdeploy/shared/format";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { CLOCK_EXACT, clockFormatter, epochMsFromIso } from "@/shared/lib/clock";
import { orpc } from "@/shared/server/orpc";

const formatExact = clockFormatter(CLOCK_EXACT);

export function ObjectPreview({
  bucketId,
  objectKey,
  detail,
  isLoading,
  onClose,
}: {
  bucketId: string;
  objectKey: string;
  detail:
    | {
        size: number;
        lastModified: string | null;
        storageClass: string;
        eTag: string | null;
        contentType: string | null;
      }
    | undefined;
  isLoading: boolean;
  onClose: () => void;
}) {
  const [presigned, setPresigned] = useState<string | null>(null);
  const presign = useMutation(orpc.storage.presign.mutationOptions());

  const mint = (then: (url: string) => void) => {
    presign.mutate(
      { bucketId, key: objectKey },
      {
        onSuccess: (res) => then(res.url),
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Couldn't create a link."),
      },
    );
  };

  const modifiedMs =
    detail?.lastModified === null ? null : epochMsFromIso(detail?.lastModified ?? "");

  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l bg-muted/20 lg:flex">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <b className="text-[13px]">Object</b>
        <span className="flex-1" />
        <Button variant="ghost" size="icon-sm" aria-label="Close preview" onClick={onClose}>
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Field label="key" value={objectKey} />
        {isLoading ? (
          <p className="px-3 py-3 text-[12px] text-muted-foreground">Loading…</p>
        ) : detail === undefined ? (
          <p className="px-3 py-3 text-[12px] text-muted-foreground">
            Couldn&rsquo;t read this object.
          </p>
        ) : (
          <>
            <Field
              label="size"
              value={`${formatBytes(detail.size)} (${detail.size.toLocaleString()} B)`}
            />
            <Field label="storage class" value={detail.storageClass} />
            <Field
              label="last modified"
              value={modifiedMs === null ? "—" : formatExact(modifiedMs)}
            />
            <Field label="content-type" value={detail.contentType ?? "—"} />
            <Field label="etag" value={detail.eTag ?? "—"} />
          </>
        )}
        {presigned !== null ? (
          <div className="px-3 py-2">
            <p className="mb-1 font-mono text-[10.5px] text-muted-foreground">
              presigned link, expires in 15 minutes
            </p>
            <code className="block max-h-24 overflow-auto rounded-md bg-card p-2 font-mono text-[10.5px] break-all ring-1 ring-foreground/10">
              {presigned}
            </code>
          </div>
        ) : null}
      </div>

      <div className="flex gap-2 border-t px-3 py-2">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 gap-1.5"
          disabled={presign.isPending}
          onClick={() => mint((url) => window.open(url, "_blank", "noopener,noreferrer"))}
        >
          <HugeiconsIcon icon={Download01Icon} strokeWidth={2} className="size-3.5" />
          Download
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1 gap-1.5"
          disabled={presign.isPending}
          onClick={() =>
            mint((url) => {
              setPresigned(url);
              void navigator.clipboard.writeText(url);
              toast.success("Link copied. It expires in 15 minutes.");
            })
          }
        >
          <HugeiconsIcon icon={Link01Icon} strokeWidth={2} className="size-3.5" />
          Copy link
        </Button>
      </div>
    </aside>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b px-3 py-1.5 font-mono text-[11.5px]">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right break-all">{value}</span>
    </div>
  );
}
