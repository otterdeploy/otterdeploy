import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isContractProcedure } from "@orpc/contract";

import { appContract } from "../src/app.contract";

type ProcedureManifest = {
  id: string;
  method: string | null;
  path: string | null;
  hasInput: boolean;
  hasOutput: boolean;
};

const requiredRouters = [
  "project",
  "environment",
  "resource",
  "resourceLink",
  "architecture",
  "deployment",
  "environmentVariable",
  "domain",
  "server",
  "monitoring",
  "backup",
  "team",
  "audit",
  "system",
] as const;

function collectProcedures(router: unknown, prefix: string[] = []): ProcedureManifest[] {
  if (!router || typeof router !== "object") {
    return [];
  }

  const entries = Object.entries(router as Record<string, unknown>);
  const output: ProcedureManifest[] = [];

  for (const [key, value] of entries) {
    const nextPrefix = [...prefix, key];

    if (isContractProcedure(value)) {
      const meta = (
        value as {
          "~orpc"?: {
            route?: {
              method?: string;
              path?: string;
            };
            inputSchema?: unknown;
            outputSchema?: unknown;
          };
        }
      )["~orpc"];

      output.push({
        id: nextPrefix.join("."),
        method: meta?.route?.method ?? null,
        path: meta?.route?.path ?? null,
        hasInput: meta?.inputSchema !== undefined,
        hasOutput: meta?.outputSchema !== undefined,
      });
      continue;
    }

    output.push(...collectProcedures(value, nextPrefix));
  }

  return output;
}

const routers = Object.keys(appContract).sort();
const missingRouters = requiredRouters.filter((name) => !routers.includes(name));

if (missingRouters.length > 0) {
  console.error(`Missing required routers: ${missingRouters.join(", ")}`);
  process.exit(1);
}

const procedures = collectProcedures(appContract).sort((left, right) => left.id.localeCompare(right.id));
const procedureHash = createHash("sha256").update(JSON.stringify(procedures)).digest("hex");

const manifest = {
  version: 1,
  routers,
  requiredRouters: [...requiredRouters],
  procedureCount: procedures.length,
  procedures,
  procedureHash,
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const snapshotPath = resolve(scriptDir, "../snapshots/contract-manifest.snapshot.json");
const snapshotPayload = `${JSON.stringify(manifest, null, 2)}\n`;
const shouldUpdate = process.argv.includes("--update");

if (shouldUpdate || !existsSync(snapshotPath)) {
  mkdirSync(dirname(snapshotPath), { recursive: true });
  writeFileSync(snapshotPath, snapshotPayload, "utf8");
  console.log(`Contract manifest snapshot updated: ${snapshotPath}`);
  process.exit(0);
}

const currentSnapshot = readFileSync(snapshotPath, "utf8");

if (currentSnapshot !== snapshotPayload) {
  console.error("Contract manifest snapshot is outdated.");
  console.error(`Expected procedure hash: ${procedureHash}`);
  console.error("Run: bun run contract:update");
  process.exit(1);
}

console.log(`Contract manifest snapshot is valid (${procedureHash.slice(0, 12)}).`);
