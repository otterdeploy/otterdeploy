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

  const modifiedMs =
    detail?.lastModified === null ? null : epochMsFromIso(detail?.lastModified ?? "");

  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0 motion-safe:slide-in-from-right-4 lg:flex">
      {/* h-10 to the pixel, matching the browse bar and the rail header. */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <b className="text-[13px]">Object</b>
        <span className="flex-1" />
        <Button variant="ghost" size="icon-sm" aria-label="Close preview" onClick={onClose}>
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
        </Button>
      </div>

      <Thumb
        objectKey={objectKey}
        contentType={detail?.contentType ?? null}
        imageUrl={imageUrl}
        onImage={setImageUrl}
        onMintUrl={onMintUrl}
      />

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

/** The preview slot: an image after one click, otherwise what the object is. */
function Thumb({
  objectKey,
  contentType,
  imageUrl,
  onImage,
  onMintUrl,
}: {
  objectKey: string;
  contentType: string | null;
  imageUrl: string | null;
  onImage: (url: string | null) => void;
  onMintUrl: () => Promise<string | null>;
}) {
  return (
    <div className="grid h-36 shrink-0 place-items-center overflow-hidden border-b bg-muted/40 px-3">
      {imageUrl !== null ? (
        <img
          src={imageUrl}
          alt={objectKey}
          className="max-h-full max-w-full object-contain"
          onError={() => onImage(null)}
        />
      ) : isImageKey(objectKey) ? (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => {
            void onMintUrl().then((url) => {
              if (url !== null) onImage(url);
            });
          }}
        >
          <HugeiconsIcon icon={Image02Icon} strokeWidth={2} className="size-3.5" />
          Preview
        </Button>
      ) : (
        <div className="flex w-full min-w-0 flex-col items-center gap-1.5 text-center text-muted-foreground">
          <HugeiconsIcon icon={File01Icon} strokeWidth={1.5} className="size-7 opacity-50" />
          <div className="font-mono text-[10.5px]">no inline preview</div>
          <div
            className="max-w-full truncate font-mono text-[10.5px] opacity-70"
            title={contentType ?? undefined}
          >
            {contentType ?? "unknown type"}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 border-b px-3 py-2">
      <span className="font-mono text-[9.5px] tracking-[0.07em] text-muted-foreground uppercase">
        {label}
      </span>
      <span className="min-w-0 font-mono text-[11.5px] leading-snug break-all">{value}</span>
    </div>
  );
}
