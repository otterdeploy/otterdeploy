import { Result } from "better-result";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createLogger } from "@otterdeploy/logger";

const log = createLogger("docker:stack");

const STACK_TMP_DIR = join(tmpdir(), "otterstack-stacks");

export interface StackServiceInfo {
  name: string;
  replicas: string;
  image: string;
}

export async function stackDeploy(
  stackName: string,
  composeContent: string,
): Promise<Result<void, Error>> {
  const tmpFile = join(
    STACK_TMP_DIR,
    `${stackName}-${randomBytes(4).toString("hex")}.yml`,
  );

  try {
    mkdirSync(STACK_TMP_DIR, { recursive: true });
    writeFileSync(tmpFile, composeContent, "utf-8");

    execSync(`docker stack deploy -c "${tmpFile}" "${stackName}"`, {
      encoding: "utf-8",
      timeout: 60_000,
    });

    log.info({ stackName }, "Stack deployed");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, stackName }, "Failed to deploy stack");
    return Result.err(err);
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }
  }
}

export async function stackRemove(
  stackName: string,
): Promise<Result<void, Error>> {
  try {
    execSync(`docker stack rm "${stackName}"`, {
      encoding: "utf-8",
      timeout: 30_000,
    });

    log.info({ stackName }, "Stack removed");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, stackName }, "Failed to remove stack");
    return Result.err(err);
  }
}

export async function stackServices(
  stackName: string,
): Promise<Result<StackServiceInfo[], Error>> {
  try {
    const output = execSync(
      `docker stack services "${stackName}" --format "{{.Name}}\\t{{.Replicas}}\\t{{.Image}}"`,
      { encoding: "utf-8", timeout: 15_000 },
    );

    const services = output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("\t");
        return {
          name: parts[0] ?? "",
          replicas: parts[1] ?? "",
          image: parts[2] ?? "",
        };
      });

    return Result.ok(services);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, stackName }, "Failed to list stack services");
    return Result.err(err);
  }
}
