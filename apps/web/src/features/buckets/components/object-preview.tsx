/**
 * The preview pane for one object.
 *
 * Shows metadata and hands out short-lived presigned URLs on demand. A
 * presign is minted when you CLICK — preview, download, copy — never when
 * you merely select a row, so looking at a listing creates no URL that
 * could leak. The control plane never proxies the bytes.
 */
import { useState } from "react";

import {
  Cancel01Icon,
  Download01Icon,
  File01Icon,
  Image02Icon,
  Link01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { CLOCK_EXACT, clockFormatter, epochMsFromIso } from "@/shared/lib/clock";

import { formatSize, isImageKey } from "../state";

const formatExact = clockFormatter(CLOCK_EXACT);

export function ObjectPreview({
  objectKey,
  detail,
  isLoading,
  onClose,
  onDownload,
  onCopyLink,
  onMintUrl,
}: {
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
  onDownload: () => void;
  onCopyLink: () => void;
  onMintUrl: () => Promise<string | null>;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const image = isImageKey(objectKey);

  const modifiedMs =
    detail?.lastModified === null ? null : epochMsFromIso(detail?.lastModified ?? "");

  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l bg-muted/20 motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0 motion-safe:slide-in-from-right-4 lg:flex">
      {/* h-10 to the pixel, matching the browse bar and the rail header. */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <b className="text-[13px]">Object</b>
        <span className="flex-1" />
        <Button variant="ghost" size="icon-sm" aria-label="Close preview" onClick={onClose}>
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
        </Button>
      </div>

      <div className="grid h-40 shrink-0 place-items-center overflow-hidden border-b bg-muted/30">
        {imageUrl !== null ? (
          <img
            src={imageUrl}
            alt={objectKey}
            className="max-h-full max-w-full object-contain"
            onError={() => setImageUrl(null)}
          />
        ) : image ? (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              void onMintUrl().then((url) => {
                if (url !== null) setImageUrl(url);
              });
            }}
          >
            <HugeiconsIcon icon={Image02Icon} strokeWidth={2} className="size-3.5" />
            Preview
          </Button>
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
            <HugeiconsIcon icon={File01Icon} strokeWidth={1.5} className="size-7 opacity-50" />
            <div className="font-mono text-[10.5px]">
              no inline preview · {detail?.contentType ?? "unknown type"}
            </div>
          </div>
        )}
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
              value={`${formatSize(detail.size)} (${detail.size.toLocaleString()} B)`}
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
      </div>

      <div className="flex gap-2 border-t px-3 py-2">
        <Button size="sm" variant="outline" className="flex-1 gap-1.5" onClick={onDownload}>
          <HugeiconsIcon icon={Download01Icon} strokeWidth={2} className="size-3.5" />
          Download
        </Button>
        <Button size="sm" variant="outline" className="flex-1 gap-1.5" onClick={onCopyLink}>
          <HugeiconsIcon icon={Link01Icon} strokeWidth={2} className="size-3.5" />
          Presign 15m
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
