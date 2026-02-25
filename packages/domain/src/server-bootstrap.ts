import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";
import { execSync } from "node:child_process";
import { createServer } from "node:net";

const log = createLogger("domain:server-bootstrap");

export interface BootstrapDeps {
  isSwarmActive: () => Promise<boolean>;
  initSwarm: () => Promise<Result<{ nodeId: string; alreadyActive: boolean }, Error>>;
  createIngressNetwork: () => Promise<Result<{ networkId: string; alreadyExists: boolean }, Error>>;
  isCaddyRunning: () => Promise<boolean>;
  bootstrapCaddy: () => Promise<Result<string, Error>>;
  healthCheckCaddy: () => Promise<boolean>;
}

export interface BootstrapResult {
  docker: { installed: boolean; version: string | null; meetsMinimum: boolean };
  swarm: { active: boolean; nodeId: string | null; initialized: boolean };
  network: { created: boolean; networkId: string | null };
  caddy: { running: boolean; bootstrapped: boolean; healthy: boolean };
  nixpacks: { installed: boolean; version: string | null };
  ports: {
    http: boolean;
    https: boolean;
    caddyAdmin: { available: boolean; localhostOnly: boolean };
    swarmManager: { available: boolean; localhostOnly: boolean };
  };
}

function checkDockerInstalled(): { installed: boolean; version: string | null; meetsMinimum: boolean } {
  try {
    const output = execSync("docker --version", { encoding: "utf-8", timeout: 5000 }).trim();
    const match = output.match(/Docker version (\d+)\.(\d+)/);
    if (!match) return { installed: true, version: output, meetsMinimum: false };

    const major = parseInt(match[1], 10);
    const version = `${match[1]}.${match[2]}`;
    return { installed: true, version, meetsMinimum: major >= 24 };
  } catch {
    return { installed: false, version: null, meetsMinimum: false };
  }
}

function checkNixpacksInstalled(): { installed: boolean; version: string | null } {
  try {
    const output = execSync("nixpacks --version", { encoding: "utf-8", timeout: 5000 }).trim();
    return { installed: true, version: output };
  } catch {
    return { installed: false, version: null };
  }
}

function checkPortAvailable(port: number, host: string = "0.0.0.0"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

// Verify a port is NOT accessible on public interfaces (security check)
function checkPortLocalhostOnly(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => {
      // Port is in use on 0.0.0.0 — that's bad, means it's publicly bound
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    // Try to bind on 0.0.0.0 — if we can, the port is NOT bound publicly (good)
    server.listen(port, "0.0.0.0");
  });
}

export async function runBootstrap(deps: BootstrapDeps): Promise<Result<BootstrapResult, Error>> {
  log.info("Starting server bootstrap sequence");

  const result: BootstrapResult = {
    docker: { installed: false, version: null, meetsMinimum: false },
    swarm: { active: false, nodeId: null, initialized: false },
    network: { created: false, networkId: null },
    caddy: { running: false, bootstrapped: false, healthy: false },
    nixpacks: { installed: false, version: null },
    ports: {
      http: false,
      https: false,
      caddyAdmin: { available: false, localhostOnly: true },
      swarmManager: { available: false, localhostOnly: true },
    },
  };

  try {
    // Step 1: Check Docker
    result.docker = checkDockerInstalled();
    if (!result.docker.installed) {
      log.error("Docker is not installed");
      return Result.ok(result);
    }
    if (!result.docker.meetsMinimum) {
      log.warn({ version: result.docker.version }, "Docker version does not meet minimum (24.0+)");
    }
    log.info({ version: result.docker.version }, "Docker found");

    // Step 2: Initialize Swarm
    const swarmActive = await deps.isSwarmActive();
    if (swarmActive) {
      result.swarm = { active: true, nodeId: null, initialized: false };
      log.info("Swarm already active");
    } else {
      const swarmResult = await deps.initSwarm();
      if (swarmResult.isOk()) {
        result.swarm = {
          active: true,
          nodeId: swarmResult.value.nodeId,
          initialized: !swarmResult.value.alreadyActive,
        };
        log.info({ nodeId: swarmResult.value.nodeId }, "Swarm initialized");
      } else {
        log.error({ err: swarmResult.error }, "Failed to initialize Swarm");
        return Result.ok(result);
      }
    }

    // Step 3: Create ingress network
    const networkResult = await deps.createIngressNetwork();
    if (networkResult.isOk()) {
      result.network = {
        created: !networkResult.value.alreadyExists,
        networkId: networkResult.value.networkId,
      };
      log.info({ networkId: networkResult.value.networkId }, "Ingress network ready");
    } else {
      log.error({ err: networkResult.error }, "Failed to create ingress network");
    }

    // Step 4: Bootstrap Caddy
    const caddyRunning = await deps.isCaddyRunning();
    if (caddyRunning) {
      result.caddy = { running: true, bootstrapped: false, healthy: false };
      log.info("Caddy already running");
    } else {
      const caddyResult = await deps.bootstrapCaddy();
      if (caddyResult.isOk()) {
        result.caddy = { running: true, bootstrapped: true, healthy: false };
        log.info("Caddy bootstrapped");
      } else {
        log.error({ err: caddyResult.error }, "Failed to bootstrap Caddy");
      }
    }

    // Caddy health check
    result.caddy.healthy = await deps.healthCheckCaddy();

    // Step 5: Check Nixpacks
    result.nixpacks = checkNixpacksInstalled();
    if (result.nixpacks.installed) {
      log.info({ version: result.nixpacks.version }, "Nixpacks found");
    } else {
      log.warn("Nixpacks not installed — Nixpacks builds will not work");
    }

    // Step 6: Port availability checks
    result.ports.http = await checkPortAvailable(80);
    result.ports.https = await checkPortAvailable(443);

    log.info("Server bootstrap sequence completed");
    return Result.ok(result);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err }, "Bootstrap failed unexpectedly");
    return Result.err(err);
  }
}

// Setup wizard step definitions
export interface SetupWizardConfig {
  adminEmail: string;
  organizationName: string;
  serverDomain: string;
  acmeEmail: string;
  s3Config?: {
    bucket: string;
    region: string;
    endpoint: string;
    accessKey: string;
    secretKey: string;
  };
}

export function validateSetupConfig(config: SetupWizardConfig): Result<SetupWizardConfig, Error> {
  if (!config.adminEmail || !config.adminEmail.includes("@")) {
    return Result.err(new Error("Invalid admin email"));
  }
  if (!config.organizationName || config.organizationName.length < 2) {
    return Result.err(new Error("Organization name must be at least 2 characters"));
  }
  if (!config.serverDomain || config.serverDomain.length < 3) {
    return Result.err(new Error("Server domain must be at least 3 characters"));
  }
  if (!config.acmeEmail || !config.acmeEmail.includes("@")) {
    return Result.err(new Error("Invalid ACME email for Let's Encrypt"));
  }
  return Result.ok(config);
}
