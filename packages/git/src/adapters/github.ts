import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

import type {
  GitProviderAdapter,
  GitRepository,
  CloneOpts,
  WebhookEvent,
} from "../types";

const log = createLogger("git:github");

export interface GitHubAdapterOpts {
  appId: string;
  privateKey: string;
}

/**
 * Create a JWT for GitHub App authentication using RS256.
 */
function createAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60, // issued at (60s clock skew buffer)
    exp: now + 600, // expires in 10 minutes
    iss: appId,
  };

  const header = { alg: "RS256", typ: "JWT" };

  const encode = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64url");

  const headerB64 = encode(header);
  const payloadB64 = encode(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signingInput);
  const signature = sign.sign(privateKey, "base64url");

  return `${signingInput}.${signature}`;
}

/**
 * Execute a shell command via child_process spawn and return stdout.
 */
function execCommand(
  command: string,
  args: string[],
): Promise<Result<string, Error>> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      resolve(Result.err(err));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(Result.ok(stdout.trim()));
      } else {
        resolve(
          Result.err(
            new Error(
              `Command "${command} ${args.join(" ")}" exited with code ${code}: ${stderr.trim()}`,
            ),
          ),
        );
      }
    });
  });
}

export function createGitHubAdapter(
  opts: GitHubAdapterOpts,
): GitProviderAdapter {
  const { appId, privateKey } = opts;

  async function getAccessToken(
    installationId: string,
  ): Promise<Result<string, Error>> {
    try {
      const jwt = createAppJwt(appId, privateKey);

      const response = await fetch(
        `https://api.github.com/app/installations/${installationId}/access_tokens`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${jwt}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );

      if (!response.ok) {
        const body = await response.text();
        return Result.err(
          new Error(
            `GitHub API error (${response.status}): ${body}`,
          ),
        );
      }

      const data = (await response.json()) as { token: string };
      return Result.ok(data.token);
    } catch (err) {
      return Result.err(
        err instanceof Error
          ? err
          : new Error(String(err)),
      );
    }
  }

  function validateWebhookSignature(
    headers: Record<string, string>,
    rawBody: string,
    secret: string,
  ): boolean {
    const signature = headers["x-hub-signature-256"];
    if (!signature) return false;

    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(rawBody);
    const expected = `sha256=${hmac.digest("hex")}`;

    // Timing-safe comparison
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected),
      );
    } catch {
      // Lengths differ
      return false;
    }
  }

  function parseWebhook(
    headers: Record<string, string>,
    body: unknown,
  ): Result<WebhookEvent, Error> {
    try {
      const eventType = headers["x-github-event"];
      const deliveryId = headers["x-github-delivery"] ?? "";

      if (!eventType) {
        return Result.err(
          new Error("Missing x-github-event header"),
        );
      }

      const payload = body as Record<string, any>;

      if (eventType === "push") {
        const ref: string = payload.ref ?? "";
        const branch = ref.replace("refs/heads/", "");
        const repo = payload.repository ?? {};
        const headCommit = payload.head_commit ?? {};
        const pusher = payload.pusher ?? {};

        // Collect changed files from commits
        const commits: any[] = payload.commits ?? [];
        const changedFiles = new Set<string>();
        for (const commit of commits) {
          for (const f of commit.added ?? []) changedFiles.add(f);
          for (const f of commit.removed ?? []) changedFiles.add(f);
          for (const f of commit.modified ?? []) changedFiles.add(f);
        }

        return Result.ok({
          type: "push",
          repository: {
            owner: repo.owner?.login ?? repo.owner?.name ?? "",
            name: repo.name ?? "",
            fullName: repo.full_name ?? "",
          },
          branch,
          commitSha: payload.after ?? headCommit.id ?? "",
          commitMessage: headCommit.message ?? "",
          changedFiles: [...changedFiles],
          pusher: {
            name: pusher.name ?? "",
            email: pusher.email ?? "",
          },
          deliveryId,
        });
      }

      if (eventType === "pull_request") {
        const pr = payload.pull_request ?? {};
        const repo = payload.repository ?? {};
        const head = pr.head ?? {};

        return Result.ok({
          type: "pull_request",
          repository: {
            owner: repo.owner?.login ?? "",
            name: repo.name ?? "",
            fullName: repo.full_name ?? "",
          },
          branch: head.ref ?? "",
          commitSha: head.sha ?? "",
          commitMessage: pr.title ?? "",
          changedFiles: [],
          pusher: {
            name: pr.user?.login ?? "",
            email: "",
          },
          deliveryId,
          prNumber: payload.number,
          action: payload.action,
        });
      }

      if (eventType === "installation") {
        const installation = payload.installation ?? {};
        const repos: any[] = payload.repositories ?? [];

        return Result.ok({
          type: "installation",
          repository: {
            owner: installation.account?.login ?? "",
            name: repos[0]?.name ?? "",
            fullName: repos[0]?.full_name ?? "",
          },
          branch: "",
          commitSha: "",
          commitMessage: "",
          changedFiles: [],
          pusher: {
            name: payload.sender?.login ?? "",
            email: "",
          },
          deliveryId,
          action: payload.action,
        });
      }

      return Result.err(
        new Error(`Unsupported GitHub event type: ${eventType}`),
      );
    } catch (err) {
      return Result.err(
        err instanceof Error
          ? err
          : new Error(String(err)),
      );
    }
  }

  async function clone(
    repo: GitRepository,
    targetDir: string,
    opts?: CloneOpts,
  ): Promise<Result<string, Error>> {
    const tokenResult = await getAccessToken(repo.gitProviderId);
    if (tokenResult.isErr()) return tokenResult;

    const token = tokenResult.value;
    const branch = opts?.branch ?? repo.branch;
    const depth = opts?.depth ?? 1;
    const url = `https://x-access-token:${token}@github.com/${repo.owner}/${repo.name}.git`;

    log.info(
      { owner: repo.owner, name: repo.name, branch },
      "cloning repository",
    );

    const cloneArgs = [
      "clone",
      "--depth",
      String(depth),
      "--single-branch",
      "--branch",
      branch,
      url,
      targetDir,
    ];

    const cloneResult = await execCommand("git", cloneArgs);
    if (cloneResult.isErr()) return cloneResult;

    // If a specific commit SHA is requested, fetch and checkout
    if (opts?.commitSha) {
      log.info({ sha: opts.commitSha }, "checking out specific commit");

      const fetchResult = await execCommand("git", [
        "-C",
        targetDir,
        "fetch",
        "origin",
        opts.commitSha,
      ]);
      if (fetchResult.isErr()) return fetchResult;

      const checkoutResult = await execCommand("git", [
        "-C",
        targetDir,
        "checkout",
        opts.commitSha,
      ]);
      if (checkoutResult.isErr()) return checkoutResult;
    }

    return Result.ok(targetDir);
  }

  return {
    clone,
    getAccessToken,
    parseWebhook,
    validateWebhookSignature,
  };
}
