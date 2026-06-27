import type { RequestLogger } from "evlog";

import { asStepLogger } from "../lib/logger";

export type AdaptResult = { ok: true; json: unknown } | { ok: false; error: string };

export type LoadResult = { ok: true } | { ok: false; error: string };

const CADDY_ADMIN_TIMEOUT_MS = 5_000;

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(CADDY_ADMIN_TIMEOUT_MS);
}

export async function adaptCaddyfile(
  caddyfile: string,
  adminUrl: string,
  rlog?: RequestLogger,
): Promise<AdaptResult> {
  const log = asStepLogger(rlog);
  log.info({ caddy: { step: "adapt", action: "request", adminUrl } });
  try {
    const response = await fetch(new URL("/adapt", adminUrl), {
      method: "POST",
      headers: { "Content-Type": "text/caddyfile" },
      body: caddyfile,
      signal: timeoutSignal(),
    });

    if (!response.ok) {
      const text = await response.text();
      log.error({ caddy: { step: "adapt", status: "failed", detail: text } });
      return { ok: false, error: text };
    }

    const json = await response.json();
    log.info({ caddy: { step: "adapt", status: "ok" } });
    return { ok: true, json };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Caddy adapt request failed";
    log.error({ caddy: { step: "adapt", status: "failed", detail: msg } });
    return { ok: false, error: msg };
  }
}

export async function loadCaddyfile(
  caddyfile: string,
  adminUrl: string,
  rlog?: RequestLogger,
): Promise<LoadResult> {
  const log = asStepLogger(rlog);
  log.info({ caddy: { step: "load", action: "request", adminUrl } });
  try {
    const response = await fetch(new URL("/load", adminUrl), {
      method: "POST",
      headers: {
        "Content-Type": "text/caddyfile",
        "Cache-Control": "must-revalidate",
      },
      body: caddyfile,
      signal: timeoutSignal(),
    });

    if (!response.ok) {
      const text = await response.text();
      log.error({ caddy: { step: "load", status: "failed", detail: text } });
      return { ok: false, error: text };
    }

    log.info({ caddy: { step: "load", status: "ok" } });
    return { ok: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Caddy load request failed";
    log.error({ caddy: { step: "load", status: "failed", detail: msg } });
    return { ok: false, error: msg };
  }
}
