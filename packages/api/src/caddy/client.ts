import type { RequestLogger } from "evlog";
import type { IncomingMessage, RequestOptions } from "node:http";

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import { asStepLogger } from "../lib/logger";

export type AdaptResult = { ok: true; json: unknown } | { ok: false; error: string };

export type LoadResult = { ok: true } | { ok: false; error: string };

const CADDY_ADMIN_TIMEOUT_MS = 5_000;
const MAX_ADMIN_RESPONSE_BYTES = 2 * 1024 * 1024;

interface AdminResponse {
  ok: boolean;
  status: number;
  body: string;
}

function collectResponse(response: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    response.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_ADMIN_RESPONSE_BYTES) {
        response.destroy(new Error("Caddy admin response exceeded 2 MiB."));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    response.on("error", reject);
  });
}

function requestOptions(target: URL, path: string, body: string): RequestOptions {
  const headers = {
    "Cache-Control": "must-revalidate",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "text/caddyfile",
    Host: "localhost",
  };
  if (target.protocol === "unix:") {
    if (!target.pathname.startsWith("/")) {
      throw new Error("Caddy Unix socket path must be absolute.");
    }
    return { socketPath: target.pathname, path, method: "POST", headers, agent: false };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Caddy admin URL must use unix, http, or https.");
  }
  return {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || undefined,
    path,
    method: "POST",
    headers,
    agent: false,
  };
}

async function requestAdmin(adminUrl: string, path: string, body: string): Promise<AdminResponse> {
  const target = new URL(adminUrl);
  const options = requestOptions(target, path, body);
  const request = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    // Wall-clock deadline, not just `req.setTimeout`: the socket-idle timeout
    // demonstrably did NOT fire when Caddy's admin endpoint accepted the
    // request and then never answered (its config mutex was held by a stuck
    // apply for three days. Od-664). That silent hang blocked every route
    // apply AND server bootstrap's caddy-reconcile step, which runs before
    // the job workers start. The timer rejects unconditionally so no
    // transport quirk can turn "Caddy is stuck" back into "wait forever".
    let settled = false;
    const settle = <T extends AdminResponse>(fn: (v: T) => void, value: T): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const timer = setTimeout(() => {
      fail(new Error(`Caddy admin ${path} timed out after ${CADDY_ADMIN_TIMEOUT_MS}ms.`));
      req.destroy();
    }, CADDY_ADMIN_TIMEOUT_MS);
    const req = request(options, (response) => {
      void collectResponse(response).then(
        (responseBody) =>
          settle(resolve, {
            ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
            status: response.statusCode ?? 0,
            body: responseBody,
          }),
        fail,
      );
    });
    req.setTimeout(CADDY_ADMIN_TIMEOUT_MS, () => {
      req.destroy(new Error("Caddy admin request timed out."));
    });
    req.on("error", fail);
    req.end(body);
  });
}

export async function adaptCaddyfile(
  caddyfile: string,
  adminUrl: string,
  rlog?: RequestLogger,
): Promise<AdaptResult> {
  const log = asStepLogger(rlog);
  log.info({ caddy: { step: "adapt", action: "request", transport: new URL(adminUrl).protocol } });
  try {
    const response = await requestAdmin(adminUrl, "/adapt", caddyfile);
    if (!response.ok) {
      log.error({ caddy: { step: "adapt", status: "failed", detail: response.body } });
      return { ok: false, error: response.body || `Caddy returned HTTP ${response.status}.` };
    }
    const json: unknown = JSON.parse(response.body);
    log.info({ caddy: { step: "adapt", status: "ok" } });
    return { ok: true, json };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Caddy adapt request failed";
    log.error({ caddy: { step: "adapt", status: "failed", detail: message } });
    return { ok: false, error: message };
  }
}

export async function loadCaddyfile(
  caddyfile: string,
  adminUrl: string,
  rlog?: RequestLogger,
): Promise<LoadResult> {
  const log = asStepLogger(rlog);
  log.info({ caddy: { step: "load", action: "request", transport: new URL(adminUrl).protocol } });
  try {
    const response = await requestAdmin(adminUrl, "/load", caddyfile);
    if (!response.ok) {
      log.error({ caddy: { step: "load", status: "failed", detail: response.body } });
      return { ok: false, error: response.body || `Caddy returned HTTP ${response.status}.` };
    }
    log.info({ caddy: { step: "load", status: "ok" } });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Caddy load request failed";
    log.error({ caddy: { step: "load", status: "failed", detail: message } });
    return { ok: false, error: message };
  }
}
