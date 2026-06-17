/**
 * Parse + normalize a user-supplied Docker Compose file into `ParsedCompose`.
 *
 * Compose is permissive — every field has 2-3 accepted spellings. We accept the
 * common real-world shapes and collapse them into one normal form (see
 * `./types`). Unsupported constructs become non-fatal `warnings`; only a
 * structurally broken file (bad YAML, no services, a service with neither image
 * nor build) is a hard error. Parsing is server-side via `Bun.YAML`.
 */
import { Result } from "better-result";
import { parse as parseYaml } from "yaml";

import type {
  ParsedBuild,
  ParsedCompose,
  ParsedComposeService,
  ParsedHealthcheck,
  ParsedMount,
  ParsedPort,
  ParsedResources,
  ParsedRestart,
} from "./types";

class ComposeParseError extends Error {
  /** 1-based line of the YAML syntax error, when the parser reports one. */
  line?: number;
  column?: number;
  constructor(message: string, line?: number, column?: number) {
    super(message);
    this.name = "ComposeParseError";
    this.line = line;
    this.column = column;
  }
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v);

export function parseCompose(
  yaml: string,
): Result<ParsedCompose, ComposeParseError> {
  // The `yaml` package resolves anchors + `<<` merge keys (which compose uses
  // and Bun.YAML mishandles) and gives ACCURATE line/column on errors (Bun's
  // are bogus — constant regardless of input).
  const raw = Result.try(() => parseYaml(yaml, { merge: true }) as unknown);
  if (raw.isErr()) {
    // The `yaml` error message reliably embeds "at line N, column M" — parse it
    // from there. (`Result.try` wraps the thrown error, so `linePos`/instanceof
    // aren't reliable; the message survives.) Drop the wrapper prefix and the
    // multi-line code snippet that follows the colon.
    const full = raw.error.message.replace(/^Unhandled exception:\s*/i, "");
    const m = full.match(/at line (\d+),? *column (\d+)/i);
    const message = full.split("\n")[0]?.replace(/:\s*$/, "") ?? full;
    return Result.err(
      new ComposeParseError(
        `Invalid YAML: ${message}`,
        m?.[1] ? Number(m[1]) : undefined,
        m?.[2] ? Number(m[2]) : undefined,
      ),
    );
  }
  if (!isObj(raw.value)) {
    return Result.err(new ComposeParseError("Compose file must be a mapping"));
  }
  const doc = raw.value;
  if (!isObj(doc.services)) {
    return Result.err(
      new ComposeParseError("Compose file has no `services` map"),
    );
  }

  const warnings: string[] = [];
  const services: ParsedComposeService[] = [];
  for (const [name, svc] of Object.entries(doc.services)) {
    if (!isObj(svc)) {
      warnings.push(`service "${name}" is not a mapping — skipped`);
      continue;
    }
    services.push(normalizeService(name, svc, warnings));
  }

  if (services.length === 0) {
    return Result.err(new ComposeParseError("No services defined"));
  }
  for (const s of services) {
    if (!s.image && !s.build) {
      return Result.err(
        new ComposeParseError(
          `Service "${s.name}" must declare an \`image\` or a \`build\``,
        ),
      );
    }
  }
  if (doc.secrets) warnings.push("top-level `secrets` are not supported yet");
  if (doc.configs) warnings.push("top-level `configs` are not supported yet");

  return Result.ok({
    name: typeof doc.name === "string" ? doc.name : null,
    services,
    volumeNames: isObj(doc.volumes) ? Object.keys(doc.volumes) : [],
    networkNames: isObj(doc.networks) ? Object.keys(doc.networks) : [],
    warnings,
  });
}

function normalizeService(
  name: string,
  svc: Obj,
  warnings: string[],
): ParsedComposeService {
  const deploy = isObj(svc.deploy) ? svc.deploy : {};
  const limits =
    isObj(deploy.resources) && isObj(deploy.resources.limits)
      ? deploy.resources.limits
      : {};

  if (svc.profiles) warnings.push(`service "${name}": \`profiles\` ignored`);

  return {
    name,
    image: typeof svc.image === "string" ? svc.image : null,
    build: normalizeBuild(svc.build),
    command: toExecArray(svc.command),
    entrypoint: toExecArray(svc.entrypoint),
    env: normalizeEnv(svc.environment),
    ports: normalizePorts(svc.ports, name, warnings),
    volumes: normalizeVolumes(svc.volumes, name, warnings),
    networks: toNameList(svc.networks),
    healthcheck: normalizeHealthcheck(svc.healthcheck),
    replicas: typeof deploy.replicas === "number" ? deploy.replicas : 1,
    resources: normalizeResources(limits),
    restart: normalizeRestart(svc.restart, deploy.restart_policy),
    dependsOn: toNameList(svc.depends_on),
  };
}

function normalizeBuild(v: unknown): ParsedBuild | null {
  if (typeof v === "string") return { context: v };
  if (!isObj(v)) return null;
  const context = typeof v.context === "string" ? v.context : ".";
  const out: ParsedBuild = { context };
  if (typeof v.dockerfile === "string") out.dockerfile = v.dockerfile;
  const args = normalizeKeyVals(v.args);
  if (Object.keys(args).length) out.args = args;
  return out;
}

/** command/entrypoint: array → as-is; string → shell form (mirrors Docker). */
function toExecArray(v: unknown): string[] | null {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.trim()) return ["/bin/sh", "-c", v];
  return null;
}

function normalizeEnv(v: unknown): Record<string, string> {
  return normalizeKeyVals(v);
}

/** Accepts a `{K: v}` map or a `["K=v", "K"]` array; values coerced to string. */
function normalizeKeyVals(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (isObj(v)) {
    for (const [k, val] of Object.entries(v)) {
      out[k] = val == null ? "" : String(val);
    }
  } else if (Array.isArray(v)) {
    for (const entry of v) {
      if (typeof entry !== "string") continue;
      const eq = entry.indexOf("=");
      if (eq === -1) out[entry] = "";
      else out[entry.slice(0, eq)] = entry.slice(eq + 1);
    }
  }
  return out;
}

function normalizePorts(
  v: unknown,
  service: string,
  warnings: string[],
): ParsedPort[] {
  if (!Array.isArray(v)) return [];
  const out: ParsedPort[] = [];
  for (const entry of v) {
    if (typeof entry === "number") {
      out.push({ target: entry, protocol: "tcp" });
      continue;
    }
    if (isObj(entry)) {
      const target = Number(entry.target);
      if (!Number.isFinite(target)) continue;
      const published =
        entry.published != null ? Number(entry.published) : undefined;
      out.push({
        target,
        ...(published != null && Number.isFinite(published)
          ? { published }
          : {}),
        protocol: entry.protocol === "udp" ? "udp" : "tcp",
      });
      continue;
    }
    if (typeof entry !== "string") continue;
    const port = parsePortString(entry, service, warnings);
    if (port) out.push(port);
  }
  return out;
}

/** "host:container[/proto]" | "ip:host:container" | "container". */
function parsePortString(
  raw: string,
  service: string,
  warnings: string[],
): ParsedPort | null {
  const slash = raw.split("/");
  const protocol = slash[1] === "udp" ? "udp" : "tcp";
  const parts = (slash[0] ?? raw).split(":");
  if (parts.length === 3) {
    warnings.push(
      `service "${service}": host IP in port "${raw}" ignored (ingress only)`,
    );
  }
  const targetStr = parts[parts.length - 1];
  const publishedStr = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  const target = Number(targetStr);
  if (!Number.isFinite(target)) return null;
  const published = publishedStr != null ? Number(publishedStr) : undefined;
  return {
    target,
    ...(published != null && Number.isFinite(published) ? { published } : {}),
    protocol,
  };
}

function normalizeVolumes(
  v: unknown,
  service: string,
  warnings: string[],
): ParsedMount[] {
  if (!Array.isArray(v)) return [];
  const out: ParsedMount[] = [];
  for (const entry of v) {
    if (isObj(entry)) {
      const target = typeof entry.target === "string" ? entry.target : null;
      if (!target) continue;
      const type =
        entry.type === "bind" || entry.type === "tmpfs" ? entry.type : "volume";
      if (type === "bind") {
        warnings.push(
          `service "${service}": bind mount to "${entry.source}" dropped (host binds unsupported)`,
        );
        continue;
      }
      out.push({
        type,
        ...(typeof entry.source === "string" ? { source: entry.source } : {}),
        target,
        readOnly: entry.read_only === true,
      });
      continue;
    }
    if (typeof entry !== "string") continue;
    const mount = parseVolumeString(entry, service, warnings);
    if (mount) out.push(mount);
  }
  return out;
}

/** "source:target[:ro]" | "/target" (anonymous). Host binds are dropped. */
function parseVolumeString(
  raw: string,
  service: string,
  warnings: string[],
): ParsedMount | null {
  const parts = raw.split(":");
  if (parts.length === 1) {
    return { type: "volume", target: parts[0] ?? raw, readOnly: false };
  }
  const source = parts[0] ?? "";
  const target = parts[1] ?? "";
  const mode = parts[2];
  // A source starting with "/" or "." is a host path — unsupported.
  if (source.startsWith("/") || source.startsWith(".")) {
    warnings.push(
      `service "${service}": bind mount "${raw}" dropped (host binds unsupported)`,
    );
    return null;
  }
  return {
    type: "volume",
    source,
    target,
    readOnly: mode === "ro",
  };
}

function normalizeHealthcheck(v: unknown): ParsedHealthcheck | null {
  if (!isObj(v)) return null;
  if (v.disable === true) return { test: [], disable: true };
  let test: string[];
  if (Array.isArray(v.test)) test = v.test.map(String);
  else if (typeof v.test === "string") test = ["CMD-SHELL", v.test];
  else return null;
  const out: ParsedHealthcheck = { test };
  if (typeof v.interval === "string") out.interval = v.interval;
  if (typeof v.timeout === "string") out.timeout = v.timeout;
  if (typeof v.retries === "number") out.retries = v.retries;
  if (typeof v.start_period === "string") out.startPeriod = v.start_period;
  return out;
}

function normalizeResources(limits: Obj): ParsedResources {
  const out: ParsedResources = {};
  const cpus = parseCpus(limits.cpus);
  if (cpus) out.cpus = cpus;
  const mem = parseMemoryMb(limits.memory);
  if (mem) out.memoryMb = mem;
  return out;
}

function parseCpus(v: unknown): string | undefined {
  if (typeof v === "number") return String(v);
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

/** "512m" | "1g" | 1073741824 (bytes) → MB. */
function parseMemoryMb(v: unknown): number | undefined {
  if (typeof v === "number") return Math.max(1, Math.round(v / 1_048_576));
  if (typeof v !== "string") return undefined;
  const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*([kmg])?b?$/i);
  if (!m?.[1]) return undefined;
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  const bytes =
    unit === "g"
      ? n * 1024 ** 3
      : unit === "m"
        ? n * 1024 ** 2
        : unit === "k"
          ? n * 1024
          : n;
  return Math.max(1, Math.round(bytes / 1_048_576));
}

function normalizeRestart(top: unknown, policy: unknown): ParsedRestart {
  if (isObj(policy)) {
    const cond = policy.condition;
    if (cond === "any") return "always";
    if (cond === "on-failure") return "on-failure";
    if (cond === "none") return "no";
  }
  if (top === "always") return "always";
  if (top === "unless-stopped") return "unless-stopped";
  if (top === "on-failure") return "on-failure";
  if (top === "no") return "no";
  return "always";
}

/** A `["a","b"]` array or `{a: ..., b: ...}` map → list of names. */
function toNameList(v: unknown): string[] {
  if (Array.isArray(v))
    return v.filter((x): x is string => typeof x === "string");
  if (isObj(v)) return Object.keys(v);
  return [];
}
