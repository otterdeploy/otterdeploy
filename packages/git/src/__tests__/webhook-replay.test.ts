import { describe, it, expect, vi } from "vitest";
import { Result } from "better-result";
import { handleWebhook } from "../webhook";
import type { GitProviderAdapter, WebhookEvent } from "../types";

function createMockAdapter(overrides: Partial<GitProviderAdapter> = {}): GitProviderAdapter {
  const mockEvent: WebhookEvent = {
    type: "push",
    repository: { owner: "acme", name: "app", fullName: "acme/app" },
    branch: "main",
    commitSha: "abc123",
    commitMessage: "fix: something",
    changedFiles: ["src/index.ts"],
    pusher: { name: "dev", email: "dev@example.com" },
    deliveryId: "test-delivery-123",
  };

  return {
    clone: vi.fn().mockResolvedValue(Result.ok("/tmp/clone")),
    getAccessToken: vi.fn().mockResolvedValue(Result.ok("token")),
    parseWebhook: vi.fn().mockReturnValue(Result.ok(mockEvent)),
    validateWebhookSignature: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

describe("P0 Security: Webhook Replay Protection", () => {
  it("rejects duplicate delivery IDs", async () => {
    const adapter = createMockAdapter();
    const checkDeliveryId = vi.fn()
      .mockResolvedValueOnce(false)  // First call: not processed
      .mockResolvedValueOnce(true);  // Second call: already processed
    const recordDeliveryId = vi.fn().mockResolvedValue(undefined);

    // First request should succeed
    const result1 = await handleWebhook({
      headers: { "x-github-delivery": "test-delivery-123" },
      rawBody: '{"ref":"refs/heads/main"}',
      parsedBody: { ref: "refs/heads/main" },
      webhookSecret: "secret",
      adapter,
      checkDeliveryId,
      recordDeliveryId,
    });

    expect(result1.isOk()).toBe(true);
    expect(recordDeliveryId).toHaveBeenCalledWith("test-delivery-123");

    // Second request with same delivery ID should be rejected (idempotent)
    const result2 = await handleWebhook({
      headers: { "x-github-delivery": "test-delivery-123" },
      rawBody: '{"ref":"refs/heads/main"}',
      parsedBody: { ref: "refs/heads/main" },
      webhookSecret: "secret",
      adapter,
      checkDeliveryId,
      recordDeliveryId,
    });

    expect(result2.isErr()).toBe(true);
    if (result2.isErr()) {
      expect(result2.error.message).toContain("Duplicate webhook delivery");
    }
  });

  it("rejects requests with invalid signatures", async () => {
    const adapter = createMockAdapter({
      validateWebhookSignature: vi.fn().mockReturnValue(false),
    });
    const checkDeliveryId = vi.fn().mockResolvedValue(false);
    const recordDeliveryId = vi.fn().mockResolvedValue(undefined);

    const result = await handleWebhook({
      headers: { "x-github-delivery": "delivery-456" },
      rawBody: '{"ref":"refs/heads/main"}',
      parsedBody: { ref: "refs/heads/main" },
      webhookSecret: "secret",
      adapter,
      checkDeliveryId,
      recordDeliveryId,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("Invalid webhook signature");
    }
  });
});
