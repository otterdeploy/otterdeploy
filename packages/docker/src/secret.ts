import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";

import { getDockerClient } from "./client";
import type { DockerSecretInfo } from "./types";

const log = createLogger("docker:secret");

function toSecretInfo(secret: any): DockerSecretInfo {
  return {
    id: secret.ID,
    name: secret.Spec?.Name ?? "",
    labels: (secret.Spec?.Labels ?? {}) as Record<string, string>,
    createdAt: secret.CreatedAt ?? new Date(0).toISOString(),
    updatedAt: secret.UpdatedAt ?? secret.CreatedAt ?? new Date(0).toISOString(),
  };
}

export async function createDockerSecret(
  name: string,
  data: string,
  labels?: Record<string, string>,
): Promise<Result<DockerSecretInfo, Error>> {
  const docker = getDockerClient();

  try {
    const created = await docker.createSecret({
      Name: name,
      Data: Buffer.from(data, "utf8").toString("base64"),
      Labels: {
        "otterstack.managed": "true",
        ...labels,
      },
    });

    const secret = (docker as any).getSecret(created.id ?? created.ID);
    const info = await secret.inspect();

    log.info({ name, secretId: info.ID }, "Docker secret created");
    return Result.ok(toSecretInfo(info));
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, name }, "Failed to create Docker secret");
    return Result.err(err);
  }
}

export async function removeDockerSecret(nameOrId: string): Promise<Result<void, Error>> {
  const docker = getDockerClient();

  try {
    let secretId = nameOrId;

    if (!nameOrId.includes("-") || nameOrId.length < 20) {
      const found = await (docker as any).listSecrets({
        filters: { name: [nameOrId] },
      });
      const match = (found ?? []).find((row: any) => row.Spec?.Name === nameOrId);
      if (!match) {
        return Result.err(new Error(`Secret "${nameOrId}" not found`));
      }
      secretId = match.ID;
    }

    const secret = (docker as any).getSecret(secretId);
    await secret.remove();

    log.info({ nameOrId }, "Docker secret removed");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, nameOrId }, "Failed to remove Docker secret");
    return Result.err(err);
  }
}

export async function listDockerSecrets(
  filters?: Record<string, string[]>,
): Promise<Result<DockerSecretInfo[], Error>> {
  const docker = getDockerClient();

  try {
    const opts: Record<string, unknown> = {};
    if (filters) {
      opts.filters = filters;
    }

    const secrets = await (docker as any).listSecrets(opts);
    return Result.ok((secrets ?? []).map((secret: any) => toSecretInfo(secret)));
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err }, "Failed to list Docker secrets");
    return Result.err(err);
  }
}
