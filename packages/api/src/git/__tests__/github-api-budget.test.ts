/**
 * What the control plane remembers about GitHub's REST budget for public-repo
 * reads: how long a spent budget is trusted to stay spent.
 */
import { Temporal } from "@otterdeploy/shared/temporal";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  apiBudgetSpent,
  noteGithubResponse,
  noteGithubUnreachable,
  resetApiBudget,
} from "../github-api-budget";

const NOW = Temporal.Instant.from("2026-10-10T12:00:00Z");

function at(seconds: number) {
  return vi.spyOn(Temporal.Now, "instant").mockReturnValue(NOW.add({ seconds }));
}

function res(status: number, headers: Record<string, string> = {}) {
  return { status, headers: { get: (name: string) => headers[name.toLowerCase()] ?? null } };
}

const epoch = (seconds: number) => String(Math.floor(NOW.epochMilliseconds / 1000) + seconds);

beforeEach(() => {
  resetApiBudget();
  at(0);
});
afterEach(() => vi.restoreAllMocks());

describe("noteGithubResponse", () => {
  it("is spent until the reset GitHub names, and not a second longer", () => {
    noteGithubResponse(
      "anonymous",
      res(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": epoch(1800) }),
    );

    expect(apiBudgetSpent("anonymous")).toBe(true);
    at(1799);
    expect(apiBudgetSpent("anonymous")).toBe(true);
    at(1801);
    expect(apiBudgetSpent("anonymous")).toBe(false);
  });

  it("learns it from the success that used the last request", () => {
    noteGithubResponse(
      "anonymous",
      res(200, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": epoch(600) }),
    );
    expect(apiBudgetSpent("anonymous")).toBe(true);
  });

  it("does not mistake an ordinary refusal for an exhausted budget", () => {
    noteGithubResponse("anonymous", res(404), "Not Found");
    noteGithubResponse("anonymous", res(403, { "x-ratelimit-remaining": "12" }), "Forbidden");
    noteGithubResponse("anonymous", res(200, { "x-ratelimit-remaining": "40" }));
    expect(apiBudgetSpent("anonymous")).toBe(false);
  });

  it("keeps the anonymous and token budgets apart", () => {
    noteGithubResponse("anonymous", res(429));
    expect(apiBudgetSpent("anonymous")).toBe(true);
    expect(apiBudgetSpent("token")).toBe(false);
  });

  it("holds a limit with no stated end for ten minutes", () => {
    noteGithubResponse("anonymous", res(403), "You have exceeded a secondary rate limit.");
    at(599);
    expect(apiBudgetSpent("anonymous")).toBe(true);
    at(601);
    expect(apiBudgetSpent("anonymous")).toBe(false);
  });

  it("never trusts a reset sooner than half a minute (a clock-skewed header)", () => {
    noteGithubResponse(
      "anonymous",
      res(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": epoch(-500) }),
    );
    expect(apiBudgetSpent("anonymous")).toBe(true);
    at(29);
    expect(apiBudgetSpent("anonymous")).toBe(true);
    at(31);
    expect(apiBudgetSpent("anonymous")).toBe(false);
  });

  it("never holds a budget longer than an hour and five minutes", () => {
    noteGithubResponse("anonymous", res(429, { "retry-after": "86400" }));
    at(65 * 60 - 1);
    expect(apiBudgetSpent("anonymous")).toBe(true);
    at(65 * 60 + 1);
    expect(apiBudgetSpent("anonymous")).toBe(false);
  });
});

describe("noteGithubUnreachable", () => {
  it("stops asking an API that is not there for a minute", () => {
    noteGithubUnreachable("anonymous");
    at(59);
    expect(apiBudgetSpent("anonymous")).toBe(true);
    at(61);
    expect(apiBudgetSpent("anonymous")).toBe(false);
  });
});
