/**
 * The gate's caching contract. `_app`'s `beforeLoad` reads the session and org
 * list through `ensureQueryData`, and nothing else in the app observes those
 * two queries, which makes them the exact shape that plain `invalidateQueries`
 * silently skips. See the note on `invalidateAuth`.
 */

import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

interface OrgListResponse {
  data: { id: string; name: string; slug: string; createdAt: string }[] | null;
  error: { status: number; message?: string } | null;
}

interface ListArgs {
  fetchOptions?: { onError?: (context: { response: Response }) => void };
}

const listOrganizations = vi.fn<(args?: ListArgs) => Promise<OrgListResponse>>();

vi.mock("@/shared/server/orpc", () => ({
  get queryClient() {
    return queryClient;
  },
}));

interface SessionResponse {
  data: { user: { id: string } } | null;
  error: { status: number; message?: string } | null;
}

const getSession = vi.fn<(args?: ListArgs) => Promise<SessionResponse>>();

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: (args?: ListArgs) => getSession(args),
    organization: { list: (args?: ListArgs) => listOrganizations(args) },
  },
}));

const { invalidateAuth, organizationsQuery, sessionQuery } = await import("./auth-queries");
const { RateLimitedError } = await import("@/shared/server/rate-limited");

const ACME = { id: "org_acme", name: "Acme", slug: "acme", createdAt: "2026-01-01" };

beforeEach(() => {
  queryClient.clear();
  listOrganizations.mockReset();
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { user: { id: "user_1" } }, error: null });
});

describe("invalidateAuth", () => {
  it("refreshes the org list even though nothing observes the query", async () => {
    // The onboarding bug, end to end. A brand-new signup's first gate read
    // caches an empty org list; the wizard then creates one. If invalidation
    // doesn't actually refetch, the next gate read still sees `[]`, decides
    // "onboarding", and bounces the user back into the wizard they just
    // finished, which is what shipped.
    listOrganizations.mockResolvedValueOnce({ data: [], error: null });
    expect(await queryClient.ensureQueryData(organizationsQuery)).toEqual([]);

    listOrganizations.mockResolvedValueOnce({ data: [ACME], error: null });
    await invalidateAuth();

    // Note this is `ensureQueryData`, not `fetchQuery`: it returns whatever is
    // cached whenever that is defined, stale or not. Marking the query stale is
    // therefore not enough: the refetch has to have already landed.
    expect(await queryClient.ensureQueryData(organizationsQuery)).toEqual([ACME]);
    expect(listOrganizations).toHaveBeenCalledTimes(2);
  });

  it("settles only once the refetch has landed", async () => {
    // Callers navigate on the line after `await invalidateAuth()`, so the
    // promise resolving early would reintroduce the same race.
    listOrganizations.mockResolvedValueOnce({ data: [], error: null });
    await queryClient.ensureQueryData(organizationsQuery);

    let resolveList: (v: OrgListResponse) => void = () => {};
    listOrganizations.mockReturnValueOnce(
      new Promise<OrgListResponse>((resolve) => {
        resolveList = resolve;
      }),
    );

    let settled = false;
    const pending = invalidateAuth().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    resolveList({ data: [ACME], error: null });
    await pending;

    expect(settled).toBe(true);
    expect(queryClient.getQueryData(organizationsQuery.queryKey)).toEqual([ACME]);
  });
});

/** better-auth's answer to a rate-limited read, with its retry hint. */
async function rateLimited(
  args?: ListArgs,
): Promise<{ data: null; error: { status: number; message: string } }> {
  args?.fetchOptions?.onError?.({
    response: new Response(null, { status: 429, headers: { "X-Retry-After": "12" } }),
  });
  return { data: null, error: { status: 429, message: "Too many requests" } };
}

describe("a rate-limited auth read", () => {
  it("the org list throws RateLimitedError with the server's retry hint, not a generic failure", async () => {
    listOrganizations.mockImplementationOnce(rateLimited);
    const failure = await queryClient.ensureQueryData(organizationsQuery).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(RateLimitedError);
    expect(failure).toMatchObject({ retryAfterSeconds: 12 });
  });

  it("the session read does too, and is never read as signed out", async () => {
    getSession.mockImplementationOnce(rateLimited);
    const failure = await queryClient.ensureQueryData(sessionQuery).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(RateLimitedError);
    expect(failure).toMatchObject({ retryAfterSeconds: 12 });
    expect(queryClient.getQueryData(sessionQuery.queryKey)).toBeUndefined();
  });
});
