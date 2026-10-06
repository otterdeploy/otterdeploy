/**
 * Talking to an installed otterdeploy control plane the way its own clients
 * do: better-auth's REST endpoints for identity (what the sign-up / sign-in
 * forms call) and the typed oRPC client on /rpc for everything else (what the
 * dashboard and CLI use). Session cookies live in a small in-memory jar and are
 * only ever written to evidence through the redactor.
 */
import type { AppRouterClient } from "@otterdeploy/api/routers/index";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { Result } from "better-result";
import * as z from "zod";

import type { Redactor } from "./evidence";

import { describeCause, LabError, type LabResult } from "./support";

export class ControlPlane {
  private readonly jar = new Map<string, string>();
  readonly rpc: AppRouterClient;

  constructor(
    readonly baseUrl: string,
    private readonly redactor: Redactor,
  ) {
    const link = new RPCLink({
      url: `${baseUrl}/rpc`,
      headers: () => this.headers(),
      fetch: async (request, init) => {
        const response = await fetch(request, init);
        this.absorb(response);
        return response;
      },
    });
    this.rpc = createORPCClient(link);
  }

  /** Same-origin headers: better-auth trusts an Origin whose host matches Host. */
  private headers(): Record<string, string> {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    return { Origin: this.baseUrl, ...(cookie ? { Cookie: cookie } : {}) };
  }

  private absorb(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const eq = pair?.indexOf("=") ?? -1;
      if (!pair || eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === "" || /max-age=0/i.test(line)) this.jar.delete(name);
      else {
        this.jar.set(name, value);
        this.redactor.add(value);
      }
    }
  }

  clearSession(): void {
    this.jar.clear();
  }

  /** POST/GET a better-auth endpoint under /api/auth. Returns status + parsed JSON. */
  async auth(
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<LabResult<{ status: number; json: unknown }>> {
    const response = await Result.tryPromise({
      try: () =>
        fetch(`${this.baseUrl}/api/auth${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: { ...this.headers(), "Content-Type": "application/json", ...extraHeaders },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        }),
      catch: (cause) => new LabError(`auth ${path}`, describeCause(cause)),
    });
    if (response.isErr()) return Result.err(response.error);
    this.absorb(response.value);
    const text = await response.value.text();
    const json = Result.try((): unknown => JSON.parse(text)).unwrapOr(text);
    if (!response.value.ok) {
      return Result.err(
        new LabError(
          `auth ${path}`,
          `HTTP ${response.value.status}: ${this.redactor.redact(text)}`,
        ),
      );
    }
    return Result.ok({ status: response.value.status, json });
  }

  /** GET a plain JSON endpoint (e.g. /health). */
  async getJson(path: string): Promise<LabResult<{ status: number; json: unknown }>> {
    return Result.tryPromise({
      try: async () => {
        const response = await fetch(`${this.baseUrl}${path}`, {
          signal: AbortSignal.timeout(15_000),
        });
        const text = await response.text();
        return {
          status: response.status,
          json: Result.try((): unknown => JSON.parse(text)).unwrapOr(text),
        };
      },
      catch: (cause) => new LabError(`GET ${path}`, describeCause(cause)),
    });
  }

  /** Wrap an oRPC call: thrown ORPCErrors become a LabError carrying code + message. */
  call<T>(where: string, thunk: () => Promise<T>): Promise<LabResult<T>> {
    return Result.tryPromise({
      try: thunk,
      catch: (cause) => {
        const shaped = z
          .object({ code: z.string(), message: z.string(), data: z.unknown().optional() })
          .safeParse(cause);
        const message = shaped.success
          ? `${shaped.data.code}: ${shaped.data.message}${shaped.data.data === undefined ? "" : ` ${JSON.stringify(shaped.data.data)}`}`
          : describeCause(cause);
        return new LabError(`rpc ${where}`, this.redactor.redact(message));
      },
    });
  }
}

export const sessionSchema = z.object({
  user: z.object({ id: z.string(), email: z.string() }),
  session: z.object({ activeOrganizationId: z.string().nullable().optional() }),
});
