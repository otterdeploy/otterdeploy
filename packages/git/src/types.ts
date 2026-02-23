import type { Result } from "better-result";

export interface GitProviderAdapter {
  clone(
    repo: GitRepository,
    targetDir: string,
    opts?: CloneOpts,
  ): Promise<Result<string, Error>>;
  getAccessToken(
    installationId: string,
  ): Promise<Result<string, Error>>;
  parseWebhook(
    headers: Record<string, string>,
    body: unknown,
  ): Result<WebhookEvent, Error>;
  validateWebhookSignature(
    headers: Record<string, string>,
    rawBody: string,
    secret: string,
  ): boolean;
}

export interface CloneOpts {
  commitSha?: string;
  depth?: number;
  branch?: string;
}

export interface GitRepository {
  owner: string;
  name: string;
  branch: string;
  rootDirectory?: string;
  gitProviderId: string;
}

export interface GitProvider {
  id: string;
  type: string;
  appId: string;
  clientId: string;
  installationId: string;
  // Secrets resolved at call time, not stored in type
}

export interface WebhookEvent {
  type: "push" | "pull_request" | "installation";
  repository: { owner: string; name: string; fullName: string };
  branch: string;
  commitSha: string;
  commitMessage: string;
  changedFiles: string[];
  pusher: { name: string; email: string };
  deliveryId: string;
  prNumber?: number;
  action?: string; // for PR: opened, synchronize, closed
}
