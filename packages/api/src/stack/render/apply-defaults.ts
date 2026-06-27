/**
 * Pure function: walk every `kind: "database"` service and fill in the
 * engine adapter's defaults wherever the entry left them blank. Used by
 * the renderer pipeline and (in later phases) by the apply path before
 * compose YAML emission.
 */

import { getEngineAdapter } from "../../swarm/database-engines";
import {
  STACK_DEFAULT_HEALTHCHECK,
  type StackFile,
  type StackService,
  type StackVolumeMount,
} from "../schema";

interface Identity {
  username: string;
  password: string;
  databaseName: string;
}

const USERNAME_KEYS = ["POSTGRES_USER", "MARIADB_USER", "MONGO_INITDB_ROOT_USERNAME"];
const PASSWORD_KEYS = ["POSTGRES_PASSWORD", "MARIADB_PASSWORD", "MONGO_INITDB_ROOT_PASSWORD"];
const DATABASE_KEYS = ["POSTGRES_DB", "MARIADB_DATABASE", "MONGO_INITDB_DATABASE"];

function pickFromEnv(
  env: Record<string, string> | undefined,
  keys: readonly string[],
  fallback: string,
): string {
  if (env) {
    for (const k of keys) if (env[k]) return env[k];
  }
  return fallback;
}

function deriveIdentity(name: string, service: StackService): Identity {
  return {
    username: pickFromEnv(service.env, USERNAME_KEYS, name),
    password: pickFromEnv(service.env, PASSWORD_KEYS, "password"),
    databaseName: pickFromEnv(service.env, DATABASE_KEYS, name),
  };
}

function ensureEnvForDatabase(
  service: StackService,
  identityEnv: string[],
): Record<string, string> | undefined {
  const env: Record<string, string> = { ...service.env };
  for (const line of identityEnv) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq);
    if (!(key in env)) env[key] = line.slice(eq + 1);
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

function ensureVolumes(
  current: StackVolumeMount[] | undefined,
  mountTarget: string,
): StackVolumeMount[] {
  if (current?.some((v) => v.target === mountTarget)) return current;
  return [...(current ?? []), { type: "volume" as const, target: mountTarget }];
}

function applyOne(name: string, service: StackService): StackService {
  const x = service["x-otterdeploy"];
  if (x.kind !== "database" || !x.engine) return service;
  const adapter = getEngineAdapter(x.engine);
  const identity = deriveIdentity(name, service);

  const identityEnv = adapter.buildEnv(identity);
  const command = service.command ?? adapter.buildCommand?.({ password: identity.password });
  const healthcheckTest = `CMD-SHELL ${adapter.buildHealthcheck(identity)}`;

  return {
    ...service,
    image: service.image ?? adapter.defaultImage,
    env: ensureEnvForDatabase(service, identityEnv),
    command,
    volumes: ensureVolumes(service.volumes, adapter.mountTarget),
    healthcheck: service.healthcheck ?? {
      test: healthcheckTest,
      interval: STACK_DEFAULT_HEALTHCHECK.interval,
      timeout: STACK_DEFAULT_HEALTHCHECK.timeout,
      retries: STACK_DEFAULT_HEALTHCHECK.retries,
    },
  };
}

export function applyEngineDefaults(file: StackFile): StackFile {
  const services: Record<string, StackService> = {};
  for (const [name, service] of Object.entries(file.services)) {
    services[name] = applyOne(name, service);
  }
  return { ...file, services };
}
