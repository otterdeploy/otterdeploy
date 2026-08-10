import { isJsonObject, type JsonObject } from "@otterdeploy/shared/json";

/** Docker daemon responses are parsed JSON, so traversal yields JsonValues. */
function record(value: unknown): JsonObject {
  return isJsonObject(value) ? value : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export interface SafeContainerInspect {
  id: string;
  name: string;
  image: string | null;
  imageId: string | null;
  createdAt: string | null;
  platform: string | null;
  driver: string | null;
  restartCount: number;
  state: {
    status: string | null;
    running: boolean;
    paused: boolean;
    restarting: boolean;
    oomKilled: boolean;
    dead: boolean;
    exitCode: number;
    startedAt: string | null;
    finishedAt: string | null;
    health: string | null;
    healthFailingStreak: number;
  };
}

export function safeContainerInspect(value: unknown): SafeContainerInspect {
  const root = record(value);
  const config = record(root.Config);
  const state = record(root.State);
  const health = record(state.Health);
  return {
    id: text(root.Id) ?? "",
    name: (text(root.Name) ?? "").replace(/^\//, ""),
    image: text(config.Image),
    imageId: text(root.Image),
    createdAt: text(root.Created),
    platform: text(root.Platform),
    driver: text(root.Driver),
    restartCount: number(root.RestartCount),
    state: {
      status: text(state.Status),
      running: state.Running === true,
      paused: state.Paused === true,
      restarting: state.Restarting === true,
      oomKilled: state.OOMKilled === true,
      dead: state.Dead === true,
      exitCode: number(state.ExitCode),
      startedAt: text(state.StartedAt),
      finishedAt: text(state.FinishedAt),
      health: text(health.Status),
      healthFailingStreak: number(health.FailingStreak),
    },
  };
}

export interface SafeImageInspect {
  id: string;
  repoTags: string[];
  repoDigests: string[];
  createdAt: string | null;
  architecture: string | null;
  os: string | null;
  variant: string | null;
  size: number;
}

export function safeImageInspect(value: unknown): SafeImageInspect {
  const root = record(value);
  return {
    id: text(root.Id) ?? "",
    repoTags: strings(root.RepoTags),
    repoDigests: strings(root.RepoDigests),
    createdAt: text(root.Created),
    architecture: text(root.Architecture),
    os: text(root.Os),
    variant: text(root.Variant),
    size: number(root.Size),
  };
}

export interface SafeVolumeInspect {
  name: string;
  driver: string;
  scope: string;
  createdAt: string | null;
}

export function safeVolumeInspect(value: unknown): SafeVolumeInspect {
  const root = record(value);
  return {
    name: text(root.Name) ?? "",
    driver: text(root.Driver) ?? "",
    scope: text(root.Scope) ?? "",
    createdAt: text(root.CreatedAt),
  };
}

export interface SafeNetworkInspect {
  id: string;
  name: string;
  createdAt: string | null;
  driver: string;
  scope: string;
  internal: boolean;
  attachable: boolean;
  ingress: boolean;
  ipv6: boolean;
  subnets: Array<{ subnet: string; gateway: string | null }>;
  attachedContainers: number;
}

export function safeNetworkInspect(value: unknown): SafeNetworkInspect {
  const root = record(value);
  const ipam = record(root.IPAM);
  const subnets = Array.isArray(ipam.Config)
    ? ipam.Config.flatMap((item) => {
        const config = record(item);
        const subnet = text(config.Subnet);
        return subnet ? [{ subnet, gateway: text(config.Gateway) }] : [];
      })
    : [];
  const containers = record(root.Containers);
  return {
    id: text(root.Id) ?? "",
    name: text(root.Name) ?? "",
    createdAt: text(root.Created),
    driver: text(root.Driver) ?? "",
    scope: text(root.Scope) ?? "",
    internal: root.Internal === true,
    attachable: root.Attachable === true,
    ingress: root.Ingress === true,
    ipv6: root.EnableIPv6 === true,
    subnets,
    attachedContainers: Object.keys(containers).length,
  };
}

const SENSITIVE_ASSIGNMENT =
  /\b(password|passwd|pwd|secret|token|api[_-]?key|database_url|redis_url|private[_-]?key|access[_-]?key|client[_-]?secret)\b(["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;

/** Best-effort defense in depth for daemon log tails shown in the admin UI. */
export function redactSensitiveText(value: string): string {
  return value
    .replace(/\b(authorization|cookie)(["']?\s*[:=]\s*).+$/gi, "$1$2[REDACTED]")
    .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/\b(otter_)[a-z0-9._~-]+/gi, "$1[REDACTED]")
    .replace(/\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi, "[REDACTED_JWT]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+@/gi, "$1[REDACTED]@")
    .replace(SENSITIVE_ASSIGNMENT, (_match, key: string, separator: string) => {
      return `${key}${separator}[REDACTED]`;
    })
    .replace(/^[a-z0-9+/]{40,}={0,2}$/i, "[REDACTED]");
}
