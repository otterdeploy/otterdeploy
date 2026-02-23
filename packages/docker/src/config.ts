import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";

import { getDockerClient } from "./client";
import type { DockerConfigInfo } from "./types";

const log = createLogger("docker:config");

export async function createDockerConfig(
  name: string,
  data: string,
  labels?: Record<string, string>,
): Promise<Result<DockerConfigInfo, Error>> {
  const docker = getDockerClient();

  try {
    const config = await (docker as any).createConfig({
      Name: name,
      Data: Buffer.from(data).toString("base64"),
      Labels: {
        "otterstack.managed": "true",
        ...(labels ?? {}),
      },
    });

    const info = await config.inspect();

    log.info({ name, configId: info.ID }, "Docker config created");
    return Result.ok({
      id: info.ID,
      name: info.Spec.Name,
      createdAt: info.CreatedAt,
      updatedAt: info.UpdatedAt,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, name }, "Failed to create Docker config");
    return Result.err(err);
  }
}

export async function removeDockerConfig(
  name: string,
): Promise<Result<void, Error>> {
  const docker = getDockerClient();

  try {
    const configs = await (docker as any).listConfigs({
      filters: { name: [name] },
    });

    const target = configs.find((c: any) => c.Spec.Name === name);
    if (!target) {
      return Result.err(new Error(`Config "${name}" not found`));
    }

    const config = (docker as any).getConfig(target.ID);
    await config.remove();

    log.info({ name }, "Docker config removed");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, name }, "Failed to remove Docker config");
    return Result.err(err);
  }
}

export async function listDockerConfigs(
  filters?: Record<string, string[]>,
): Promise<Result<DockerConfigInfo[], Error>> {
  const docker = getDockerClient();

  try {
    const opts: Record<string, unknown> = {};
    if (filters) {
      opts.filters = filters;
    }

    const configs = await (docker as any).listConfigs(opts);

    const result: DockerConfigInfo[] = (configs ?? []).map((c: any) => ({
      id: c.ID,
      name: c.Spec.Name,
      createdAt: c.CreatedAt,
      updatedAt: c.UpdatedAt,
    }));

    return Result.ok(result);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err }, "Failed to list Docker configs");
    return Result.err(err);
  }
}
