/**
 * POST a source tarball to the control plane's raw upload route
 * (`/api/services/:resourceId/source`) for a `source: "upload"` deploy. Not an
 * oRPC call — the body is a binary stream — so it goes over plain fetch, reusing
 * the CLI's local-cert-trusting fetch for dev proxies.
 */

import { readFileSync } from "node:fs";

import { fetchFor } from "./local-tls";

export interface UploadResult {
  deploymentId: string;
}

export async function uploadSource(opts: {
  url: string;
  token: string;
  resourceId: string;
  tarballPath: string;
}): Promise<UploadResult> {
  const endpoint = `${opts.url.replace(/\/$/, "")}/api/services/${opts.resourceId}/source`;
  const body = readFileSync(opts.tarballPath);
  const doFetch = fetchFor(opts.url);

  const res = await doFetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      "Content-Type": "application/gzip",
    },
    body,
  });

  if (!res.ok) {
    let detail = "";
    try {
      const parsed = (await res.json()) as { error?: string };
      detail = parsed.error ?? "";
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(`source upload failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }

  return (await res.json()) as UploadResult;
}
