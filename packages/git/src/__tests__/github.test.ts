import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import { createGitHubAdapter } from "../adapters/github";

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

describe("GitHubAdapter", () => {
  // We need a dummy private key for construction, but won't actually call getAccessToken
  const adapter = createGitHubAdapter({
    appId: "12345",
    privateKey: "not-a-real-key",
  });

  describe("validateWebhookSignature", () => {
    const secret = "test-webhook-secret";
    const body = '{"action":"push","ref":"refs/heads/main"}';

    it("returns true for a valid signature", () => {
      const signature = makeSignature(body, secret);
      const headers = { "x-hub-signature-256": signature };

      expect(adapter.validateWebhookSignature(headers, body, secret)).toBe(
        true,
      );
    });

    it("returns false for an invalid signature", () => {
      const headers = { "x-hub-signature-256": "sha256=invalid" };

      expect(adapter.validateWebhookSignature(headers, body, secret)).toBe(
        false,
      );
    });

    it("returns false when signature header is missing", () => {
      const headers = {};

      expect(adapter.validateWebhookSignature(headers, body, secret)).toBe(
        false,
      );
    });
  });

  describe("parseWebhook", () => {
    it("parses a push event correctly", () => {
      const headers = {
        "x-github-event": "push",
        "x-github-delivery": "delivery-123",
      };
      const body = {
        ref: "refs/heads/main",
        after: "abc123def456",
        repository: {
          name: "my-repo",
          full_name: "owner/my-repo",
          owner: { login: "owner" },
        },
        head_commit: {
          id: "abc123def456",
          message: "feat: add new feature",
        },
        pusher: {
          name: "john",
          email: "john@example.com",
        },
        commits: [
          {
            added: ["src/new.ts"],
            removed: [],
            modified: ["src/index.ts"],
          },
        ],
      };

      const result = adapter.parseWebhook(headers, body);

      expect(result.isOk()).toBe(true);
      const event = result.unwrap();
      expect(event.type).toBe("push");
      expect(event.repository.owner).toBe("owner");
      expect(event.repository.name).toBe("my-repo");
      expect(event.repository.fullName).toBe("owner/my-repo");
      expect(event.branch).toBe("main");
      expect(event.commitSha).toBe("abc123def456");
      expect(event.commitMessage).toBe("feat: add new feature");
      expect(event.changedFiles).toContain("src/new.ts");
      expect(event.changedFiles).toContain("src/index.ts");
      expect(event.pusher.name).toBe("john");
      expect(event.deliveryId).toBe("delivery-123");
    });

    it("parses a pull_request event correctly", () => {
      const headers = {
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-456",
      };
      const body = {
        action: "opened",
        number: 42,
        pull_request: {
          title: "Fix bug in auth",
          head: {
            ref: "fix/auth-bug",
            sha: "sha789",
          },
          user: { login: "jane" },
        },
        repository: {
          name: "my-repo",
          full_name: "owner/my-repo",
          owner: { login: "owner" },
        },
      };

      const result = adapter.parseWebhook(headers, body);

      expect(result.isOk()).toBe(true);
      const event = result.unwrap();
      expect(event.type).toBe("pull_request");
      expect(event.branch).toBe("fix/auth-bug");
      expect(event.commitSha).toBe("sha789");
      expect(event.prNumber).toBe(42);
      expect(event.action).toBe("opened");
      expect(event.deliveryId).toBe("delivery-456");
    });

    it("extracts delivery ID from headers", () => {
      const headers = {
        "x-github-event": "push",
        "x-github-delivery": "unique-delivery-id",
      };
      const body = {
        ref: "refs/heads/main",
        after: "abc123",
        repository: {
          name: "repo",
          full_name: "owner/repo",
          owner: { login: "owner" },
        },
        head_commit: { id: "abc123", message: "msg" },
        pusher: { name: "user", email: "user@test.com" },
        commits: [],
      };

      const result = adapter.parseWebhook(headers, body);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().deliveryId).toBe("unique-delivery-id");
    });

    it("returns error for missing event header", () => {
      const headers = {};
      const body = {};

      const result = adapter.parseWebhook(headers, body);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain("x-github-event");
      }
    });

    it("returns error for unsupported event types", () => {
      const headers = {
        "x-github-event": "unknown_event",
        "x-github-delivery": "d-1",
      };
      const body = {};

      const result = adapter.parseWebhook(headers, body);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain("Unsupported");
      }
    });
  });
});
