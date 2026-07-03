import { beforeEach, describe, expect, it, vi } from "vitest";

// The dispatcher is pure routing; each event handler is its own module. Mock
// them so we assert only the routing (event → handler, payload/delivery passed
// through) without touching the DB.
vi.mock("./handle-installation", () => ({ handleInstallation: vi.fn() }));
vi.mock("./handle-installation-repos", () => ({ handleInstallationRepos: vi.fn() }));
vi.mock("./handle-push", () => ({ handlePush: vi.fn() }));
vi.mock("./handle-pull-request", () => ({ handlePullRequest: vi.fn() }));

import { handlePullRequest } from "./handle-pull-request";
import { handlePush } from "./handle-push";
import { handleGithubWebhook } from "./webhook-handler";

type Mock = ReturnType<typeof vi.fn>;

describe("handleGithubWebhook dispatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes pull_request to handlePullRequest with payload + deliveryId", async () => {
    (handlePullRequest as unknown as Mock).mockResolvedValue({
      kind: "pull_request",
      action: "opened",
      prNumber: 7,
      outcome: "preview-deployed",
      environmentsTouched: 1,
      deploymentsCreated: 2,
    });
    const payload = { action: "opened", number: 7 };

    const result = await handleGithubWebhook({
      event: "pull_request",
      payload,
      deliveryId: "d-1",
    });

    expect(handlePullRequest).toHaveBeenCalledWith(payload, "d-1");
    expect(result).toMatchObject({ kind: "pull_request", outcome: "preview-deployed" });
  });

  it("still routes push to handlePush", async () => {
    (handlePush as unknown as Mock).mockResolvedValue({
      kind: "push",
      ref: "refs/heads/main",
      sha: "abc",
      deploymentsCreated: 1,
      projectsTouched: 1,
    });

    await handleGithubWebhook({ event: "push", payload: {}, deliveryId: "d-2" });
    expect(handlePush).toHaveBeenCalledWith({}, "d-2");
    expect(handlePullRequest).not.toHaveBeenCalled();
  });

  it("ignores unknown events", async () => {
    const result = await handleGithubWebhook({ event: "star", payload: {}, deliveryId: "d-3" });
    expect(result).toEqual({ kind: "ignored", event: "star" });
    expect(handlePullRequest).not.toHaveBeenCalled();
  });
});
