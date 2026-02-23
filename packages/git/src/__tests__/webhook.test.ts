import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import { handleWebhook } from "../webhook";
import type { GitProviderAdapter, WebhookEvent } from "../types";
import { Result } from "better-result";

vi.mock("@otterdeploy/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function makeSignature(body: string, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(body);
  return `sha256=${hmac.digest("hex")}`;
}

function createMockEvent(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    type: "push",
    repository: { owner: "owner", name: "repo", fullName: "owner/repo" },
    branch: "main",
    commitSha: "abc123",
    commitMessage: "test commit",
    changedFiles: ["src/index.ts"],
    pusher: { name: "user", email: "user@test.com" },
    deliveryId: "delivery-001",
    ...overrides,
  };
}

function createMockAdapter(
  overrides: Partial<GitProviderAdapter> = {},
): GitProviderAdapter {
  return {
    clone: vi.fn(),
    getAccessToken: vi.fn(),
    parseWebhook: vi
      .fn()
      .mockReturnValue(Result.ok(createMockEvent())),
    validateWebhookSignature: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

describe("handleWebhook", () => {
  const webhookSecret = "test-secret";
  const rawBody = '{"ref":"refs/heads/main"}';

  it("processes a valid webhook successfully", async () => {
    const checkDeliveryId = vi.fn().mockResolvedValue(false);
    const recordDeliveryId = vi.fn().mockResolvedValue(undefined);
    const adapter = createMockAdapter();

    const result = await handleWebhook({
      headers: {
        "x-github-event": "push",
        "x-github-delivery": "delivery-001",
        "x-hub-signature-256": makeSignature(rawBody, webhookSecret),
      },
      rawBody,
      parsedBody: JSON.parse(rawBody),
      webhookSecret,
      adapter,
      checkDeliveryId,
      recordDeliveryId,
    });

    expect(result.isOk()).toBe(true);
    const event = result.unwrap();
    expect(event.type).toBe("push");
    expect(event.deliveryId).toBe("delivery-001");
    expect(recordDeliveryId).toHaveBeenCalledWith("delivery-001");
  });

  it("rejects invalid webhook signature", async () => {
    const checkDeliveryId = vi.fn().mockResolvedValue(false);
    const recordDeliveryId = vi.fn().mockResolvedValue(undefined);
    const adapter = createMockAdapter({
      validateWebhookSignature: vi.fn().mockReturnValue(false),
    });

    const result = await handleWebhook({
      headers: {
        "x-github-event": "push",
        "x-hub-signature-256": "sha256=invalid",
      },
      rawBody,
      parsedBody: JSON.parse(rawBody),
      webhookSecret,
      adapter,
      checkDeliveryId,
      recordDeliveryId,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("signature");
    }
    expect(recordDeliveryId).not.toHaveBeenCalled();
  });

  it("rejects duplicate delivery IDs (replay protection)", async () => {
    const checkDeliveryId = vi.fn().mockResolvedValue(true); // already seen
    const recordDeliveryId = vi.fn().mockResolvedValue(undefined);
    const adapter = createMockAdapter();

    const result = await handleWebhook({
      headers: {
        "x-github-event": "push",
        "x-github-delivery": "delivery-001",
        "x-hub-signature-256": makeSignature(rawBody, webhookSecret),
      },
      rawBody,
      parsedBody: JSON.parse(rawBody),
      webhookSecret,
      adapter,
      checkDeliveryId,
      recordDeliveryId,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("Duplicate");
    }
    expect(recordDeliveryId).not.toHaveBeenCalled();
  });

  it("records new delivery IDs", async () => {
    const checkDeliveryId = vi.fn().mockResolvedValue(false);
    const recordDeliveryId = vi.fn().mockResolvedValue(undefined);
    const adapter = createMockAdapter({
      parseWebhook: vi
        .fn()
        .mockReturnValue(
          Result.ok(createMockEvent({ deliveryId: "new-delivery-999" })),
        ),
    });

    const result = await handleWebhook({
      headers: {
        "x-github-event": "push",
        "x-github-delivery": "new-delivery-999",
        "x-hub-signature-256": makeSignature(rawBody, webhookSecret),
      },
      rawBody,
      parsedBody: JSON.parse(rawBody),
      webhookSecret,
      adapter,
      checkDeliveryId,
      recordDeliveryId,
    });

    expect(result.isOk()).toBe(true);
    expect(checkDeliveryId).toHaveBeenCalledWith("new-delivery-999");
    expect(recordDeliveryId).toHaveBeenCalledWith("new-delivery-999");
  });
});
