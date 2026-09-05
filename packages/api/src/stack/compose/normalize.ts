/**
 * Field normalizers for the Compose parser (see `./parse.ts`). Compose is
 * permissive (every field has 2-3 accepted spellings) so each helper here
 * collapses the accepted real-world shapes into one normal form (see
 * `./types`). Unsupported constructs push non-fatal entries onto `warnings`.
 */

import { isJsonObject, type JsonObject } from "@otterdeploy/shared/json";

import type {
  ParsedBuild,
  ParsedComposeService,
  ParsedHealthcheck,
  ParsedMount,
  ParsedPort,
  ParsedResources,
  ParsedRestart,
} from "./types";

import { allowedHostBind, allowedHostBindPaths } from "../../lib/host-binds";
import { splitCommandString } from "./command-string";

/** A mapping node in the parsed compose YAML tree. YAML parses to the same
 *  scalar tree JSON does, so the shared JSON vocabulary is the honest type. */
export type Obj = JsonObject;

export const isObj: (v: unknown) => v is Obj = isJsonObject;

import { normalizeLabels } from "./labels";

export function normalizeService(name: string, svc: Obj, warnings: string[]): ParsedComposeService {
  const deploy = isObj(svc.deploy) ? svc.deploy : {};
  const limits =
    isObj(deploy.resources) && isObj(deploy.resources.limits) ? deploy.resources.limits : {};

  if (svc.profiles) warnings.push(`service "${name}": \`profiles\` ignored`);

  return {
    name,
    image: typeof svc.image === "string" ? svc.image : null,
    build: normalizeBuild(svc.build),
    command: toExecArray(svc.command),
    entrypoint: toExecArray(svc.entrypoint),
    env: normalizeEnv(svc.environment),
    envFile: normalizeEnvFile(svc.env_file),
    ports: normalizePorts(svc.ports, name, warnings),
    volumes: normalizeVolumes(svc.volumes, name, warnings),
    networks: toNameList(svc.networks),
    healthcheck: normalizeHealthcheck(svc.healthcheck),
    replicas: typeof deploy.replicas === "number" ? deploy.replicas : 1,
    resources: normalizeResources(limits),
    restart: normalizeRestart(svc.restart, deploy.restart_policy),
    dependsOn: toNameList(svc.depends_on),
    labels: normalizeLabels(svc.labels),
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

/**
 * command/entrypoint: array → as-is; string → split into argv.
 *
 * NOT `/bin/sh -c <string>`. That is DOCKERFILE shell-form semantics; the
 * Compose spec says a string command is word-split into a list, the same shape
 * as the array form. Wrapping it broke every image with an ENTRYPOINT of its
 * own, because the wrapper became the entrypoint's first argument: Authentik
 * (`command: server`, entrypoint `dumb-init -- ak`) ran
 * `ak /bin/sh -c server` and died on "Unknown command: '/bin/sh'", restarting
 * forever. MinIO and Plausible were mis-assembled the same way.
 */
function toExecArray(v: unknown): string[] | null {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.trim()) {
    const argv = splitCommandString(v);
    return argv.length > 0 ? argv : null;
  }
  return null;
}

function normalizeEnv(v: unknown): Record<string, string> {
  return normalizeKeyVals(v);
}

/** `env_file` accepts a string or a list of paths (relative to the stack tree).
 *  The long form `{ path, required }` is reduced to its path. */
function normalizeEnvFile(v: unknown): string[] {
  const one = (x: unknown): string | null => {
    if (typeof x === "string") return x;
    if (isObj(x) && typeof x.path === "string") return x.path;
    return null;
  };
  if (Array.isArray(v)) return v.map(one).filter((p): p is string => p != null);
  const single = one(v);
  return single ? [single] : [];
}

/** Accepts a `{K: v}` map or a `["K=v", "K"]` array; values coerced to string. */
function normalizeKeyVals(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (isObj(v)) {
    for (const [k, val] of Object.entries(v)) {
      // Compose values are scalars; a nested map/list is author error, kept
      // visible as JSON rather than an opaque "[object Object]".
      if (val == null) out[k] = "";
      else if (typeof val === "object") out[k] = JSON.stringify(val);
      else out[k] = String(val);
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

function normalizePorts(v: unknown, service: string, warnings: string[]): ParsedPort[] {
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
      const published = entry.published != null ? Number(entry.published) : undefined;
      out.push({
        target,
        ...(published != null && Number.isFinite(published) ? { published } : {}),
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

/** `1000-2000`, compose's port-range form. Only used to make the drop warning
 *  name the actual problem instead of "is not a number". */
const RANGE = /^\d+-\d+$/;

/** "host:container[/proto]" | "ip:host:container" | "container". */
function parsePortString(raw: string, service: string, warnings: string[]): ParsedPort | null {
  const slash = raw.split("/");
  const protocol = slash[1] === "udp" ? "udp" : "tcp";
  const parts = (slash[0] ?? raw).split(":");
  if (parts.length === 3) {
    warnings.push(`service "${service}": host IP in port "${raw}" ignored (ingress only)`);
  }
  const targetStr = parts[parts.length - 1];
  const publishedStr = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  const target = Number(targetStr);
  if (!Number.isFinite(target)) {
    // A port this function cannot read used to vanish without a word, and a
    // MISSING port is invisible in a way a wrong one is not: the stack applies
    // clean, the service shows green, and the traffic that port carried simply
    // never arrives. `10000-20000/udp` (LiveKit SIP's RTP media) is the case
    // that found this — a range parses to NaN here, so the whole media path
    // disappeared while every other check passed. Same reasoning as
    // `warnUnmountableBind` below: if the platform is going to drop it, it says
    // so at parse time, where the wizard already renders warnings.
    warnings.push(
      RANGE.test(targetStr ?? "")
        ? `service "${service}": port range "${raw}" is not supported and was dropped. ` +
            `Publish a single port per entry, or use the upstream's single-port option ` +
            `where it has one`
        : `service "${service}": port "${raw}" is not a number and was dropped`,
    );
    return null;
  }
  const published = publishedStr != null ? Number(publishedStr) : undefined;
  return {
    target,
    ...(published != null && Number.isFinite(published) ? { published } : {}),
    protocol,
  };
}

/**
 * Warn when a bind names a host path the platform will not mount.
 *
 * A denied bind used to disappear in silence: the stack applied "successfully"
 * and the container then failed for a reason that pointed at the image rather
 * than at us (Dozzle: "Could not connect to any Docker Engine"). The mount is
 * still dropped. This only makes the drop say so, at parse time, where the
 * wizard already renders warnings.
 */
function warnUnmountableBind(mount: ParsedMount, service: string, warnings: string[]): void {
  if (mount.type !== "bind" || !mount.source) return;
  if (!mount.source.startsWith("/")) return;
  if (allowedHostBind(mount.source)) return;
  warnings.push(
    `service "${service}": host path "${mount.source}" is not mounted. Compose stacks are ` +
      `confined to their own files. Permitted host paths: ${allowedHostBindPaths().join(", ")}`,
  );
}

function normalizeVolumes(v: unknown, service: string, warnings: string[]): ParsedMount[] {
  if (!Array.isArray(v)) return [];
  const out: ParsedMount[] = [];
  for (const entry of v) {
    if (isObj(entry)) {
      const target = typeof entry.target === "string" ? entry.target : null;
      if (!target) continue;
      const type = entry.type === "bind" || entry.type === "tmpfs" ? entry.type : "volume";
      // Bind sources (host paths) are recorded as-is; the deploy-time compiler
      // resolves them against the materialized stack tree (see reconcile-map),
      // or mounts them for real when the path is allowlisted (lib/host-binds).
      const mount: ParsedMount = {
        type,
        ...(typeof entry.source === "string" ? { source: entry.source } : {}),
        target,
        readOnly: entry.read_only === true,
      };
      warnUnmountableBind(mount, service, warnings);
      out.push(mount);
      continue;
    }
    if (typeof entry !== "string") continue;
    const mount = parseVolumeString(entry);
    if (!mount) continue;
    warnUnmountableBind(mount, service, warnings);
    out.push(mount);
  }
  return out;
}

/** "source:target[:ro]" | "/target" (anonymous). A source starting with "/" or
 *  "." is a host bind (resolved to the materialized stack dir at deploy); else
 *  a named volume. */
function parseVolumeString(raw: string): ParsedMount | null {
  const parts = raw.split(":");
  if (parts.length === 1) {
    return { type: "volume", target: parts[0] ?? raw, readOnly: false };
  }
  const source = parts[0] ?? "";
  const target = parts[1] ?? "";
  const mode = parts[2];
  const isBind = source.startsWith("/") || source.startsWith(".");
  return {
    type: isBind ? "bind" : "volume",
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
    unit === "g" ? n * 1024 ** 3 : unit === "m" ? n * 1024 ** 2 : unit === "k" ? n * 1024 : n;
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
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (isObj(v)) return Object.keys(v);
  return [];
}
