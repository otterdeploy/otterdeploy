/**
 * The workbench's verbs: presign, download, copy links, upload, delete.
 *
 * Split from the browse controller so state (where you are, what is ticked)
 * and action (what happens to it) each fit on a screen. Every verb here mints
 * a short-lived presigned URL ON CLICK — never on select — and the control
 * plane never proxies the bytes.
 */
import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { Result } from "better-result";
import { toast } from "sonner";

import { orpc } from "@/shared/server/orpc";

/** Bulk downloads fan out one anchor click per key; keep it sane. */
const DOWNLOAD_CAP = 20;
/** Bulk presigns are minted sequentially; cap so a stray select-all is cheap. */
const PRESIGN_CAP = 50;

export function useObjectVerbs({
  bucketId,
  prefix,
  selected,
  onDeleted,
  refetchAll,
}: {
  bucketId: string;
  prefix: string;
  selected: ReadonlyMap<string, number>;
  onDeleted: () => void;
  refetchAll: () => void;
}) {
  const presign = useMutation(orpc.storage.presign.mutationOptions());
  const remove = useMutation(orpc.storage.remove.mutationOptions());
  const [uploading, setUploading] = useState(false);

  const mintUrl = async (key: string): Promise<string | null> => {
    const minted = await Result.tryPromise({
      try: () => presign.mutateAsync({ bucketId, key, method: "GET" }),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    if (minted.isErr()) {
      toast.error(minted.error.message || "Couldn't create a link.");
      return null;
    }
    return minted.value.url;
  };

  const downloadKey = async (key: string) => {
    const url = await mintUrl(key);
    if (url !== null) triggerDownload(url, key);
  };

  const copyLinkForKey = async (key: string) => {
    const url = await mintUrl(key);
    if (url === null) return;
    await copyText(url);
    toast.success("Link copied. It expires in 15 minutes.");
  };

  const downloadSelected = async () => {
    const keys = [...selected.keys()].slice(0, DOWNLOAD_CAP);
    if (selected.size > DOWNLOAD_CAP) {
      toast.info(`Downloading the first ${DOWNLOAD_CAP} of ${selected.size} selected.`);
    }
    for (const key of keys) {
      // Sequential on purpose: parallel presigns are fine, but firing twenty
      // anchor clicks in one tick makes browsers drop all but a few.
      await downloadKey(key);
    }
  };

  const copyLinksSelected = async () => {
    const keys = [...selected.keys()].slice(0, PRESIGN_CAP);
    const urls: string[] = [];
    for (const key of keys) {
      const url = await mintUrl(key);
      if (url === null) return;
      urls.push(url);
    }
    await copyText(urls.join("\n"));
    toast.success(
      selected.size > PRESIGN_CAP
        ? `Copied links for the first ${PRESIGN_CAP} of ${selected.size}. They expire in 15 minutes.`
        : `Copied ${urls.length} link${urls.length === 1 ? "" : "s"}. They expire in 15 minutes.`,
    );
  };

  const deleteSelected = () => {
    const keys = [...selected.keys()];
    if (keys.length === 0) return;
    remove.mutate(
      { bucketId, keys },
      {
        onSuccess: (res) => {
          const n = res.deleted.length;
          if (res.failed.length > 0) {
            toast.error(`Deleted ${n}, but ${res.failed.length} failed: ${res.failed[0]?.reason}`);
          } else {
            toast.success(`Deleted ${n} object${n === 1 ? "" : "s"}`);
          }
          onDeleted();
          refetchAll();
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Couldn't delete the objects."),
      },
    );
  };

  /** Presign a PUT per file, then the browser talks straight to the bucket. */
  const upload = async (files: readonly File[]) => {
    if (files.length === 0 || uploading) return;
    setUploading(true);
    let done = 0;
    for (const file of files) {
      const key = `${prefix}${file.name}`;
      const put = await Result.tryPromise({
        try: async () => {
          const minted = await presign.mutateAsync({ bucketId, key, method: "PUT" });
          const res = await fetch(minted.url, { method: "PUT", body: file });
          if (!res.ok) throw new Error(`the bucket answered ${res.status} for ${file.name}`);
        },
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      });
      if (put.isErr()) {
        toast.error(`Upload failed: ${put.error.message}`);
        break;
      }
      done += 1;
    }
    setUploading(false);
    if (done > 0) {
      toast.success(`Uploaded ${done} file${done === 1 ? "" : "s"}`);
      refetchAll();
    }
  };

  return {
    mintUrl,
    downloadKey,
    copyLinkForKey,
    downloadSelected,
    copyLinksSelected,
    deleteSelected,
    isDeleting: remove.isPending,
    upload,
    uploading,
  };
}

function triggerDownload(url: string, key: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = key.slice(key.lastIndexOf("/") + 1);
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

async function copyText(text: string): Promise<void> {
  // Best-effort: clipboard access can be denied; the presign already
  // succeeded, so surface nothing worse than a missing paste.
  await Result.tryPromise({
    try: () => navigator.clipboard.writeText(text),
    catch: () => new Error("clipboard unavailable"),
  });
}
