/**
 * Compose `extends` resolution, run before `normalizeService` ever sees a
 * service (see `./parse.ts`).
 *
 * A service that extends another inherits the base's keys and overrides them
 * with its own. Real upstream stacks lean on this hard: PostHog's
 * `docker-compose.hobby.yml` declares almost nothing itself — every service is
 * `extends: { file: docker-compose.base.yml, service: <name> }` plus a handful
 * of overrides — so without resolution the file fails the parser's first
 * structural check ("must declare an `image` or a `build`") and no amount of
 * downstream leniency can recover it.
 *
 * Cross-file bases need the sibling file's TEXT, which this module takes as a
 * plain `path -> yaml` record rather than reading from disk. That keeps the
 * parser browser-safe (see `__tests__/browser-safe.test.ts`): the wizard's live
 * preview passes nothing and gets a precise error naming the missing file,
 * while the builder passes the files it already has from the git checkout.
 *
 * Merge semantics follow the Compose spec's "Merge and override" rules, which
 * are per-key rather than uniform — see `mergeValue`.
 */
import { Result, TaggedError } from "better-result";
import { parse as parseYaml } from "yaml";

import type { JsonValue } from "@otterdeploy/shared/json";

import { isObj, type Obj } from "./normalize";

export class ComposeExtendsError extends TaggedError("ComposeExtendsError")<{
  message: string;
}>() {
  constructor(message: string) {
    super({ message });
  }
}

/**
 * Keys the spec explicitly refuses to inherit. They name OTHER services or
 * their state, so carrying them across would silently invent edges: a base
 * whose `depends_on` lists a sibling that only exists in the base's own file
 * would make the extending stack depend on a service it never declares.
 */
const NEVER_INHERITED = new Set(["depends_on", "volumes_from", "links"]);

/** Multi-value options the spec concatenates rather than overrides. */
const CONCATENATED = new Set([
  "ports",
  "expose",
  "external_links",
  "dns",
  "dns_opt",
  "dns_search",
  "tmpfs",
  "cap_add",
  "cap_drop",
  "devices",
  "device_cgroup_rules",
  "group_add",
  "security_opt",
]);

/**
 * `KEY=value` bags. Each accepts a mapping OR a list, on either side, so both
 * are read into a map before merging and the result is emitted as a map. That
 * shape change is invisible downstream: `normalizeKeyVals` accepts both, and a
 * bare list entry (`- FOO`, "inherit from the host") reads as an empty value in
 * either spelling.
 */
const KEY_VALUE = new Set(["environment", "labels", "sysctls", "extra_hosts", "annotations", "args"]);

/** Mappings merged key-by-key rather than replaced wholesale. */
const MERGED_MAPPINGS = new Set([
  "build",
  "deploy",
  "healthcheck",
  "logging",
  "networks",
  "ulimits",
  "develop",
  "blkio_config",
]);

/** Directory part of a `/`-joined path, "" for a bare filename. */
function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/**
 * Join a compose-relative path onto a directory, collapsing `.` and `..`.
 *
 * Hand-rolled rather than `node:path` because this module is bundled for the
 * browser; compose paths are always `/`-separated, so the general case the
 * platform helper exists for never arises here.
 */
function joinPath(fromDir: string, rel: string): string {
  const segments = fromDir === "" ? [] : fromDir.split("/");
  for (const part of rel.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return segments.join("/");
}

/** A `KEY=value` bag in either spelling, read into a map. `null` when the value
 *  is neither a mapping nor a list of strings. */
function toKeyValueMap(value: JsonValue): Obj | null {
  if (isObj(value)) return { ...value };
  if (!Array.isArray(value)) return null;
  const out: Obj = {};
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    const eq = entry.indexOf("=");
    if (eq === -1) out[entry] = null;
    else out[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return out;
}

function mergeKeyValues(base: JsonValue, local: JsonValue): JsonValue {
  const baseMap = toKeyValueMap(base);
  const localMap = toKeyValueMap(local);
  // An unreadable shape is author error; the local value is what they wrote
  // last, so let it stand rather than guessing at a merge.
  if (!baseMap || !localMap) return local;
  return { ...baseMap, ...localMap };
}

/** Concatenate two lists, dropping entries the local side already carries
 *  verbatim. Structural identity, so long-form and short-form spellings of the
 *  same port both survive — which matches what compose itself does. */
function concatUnique(base: JsonValue, local: JsonValue): JsonValue {
  if (!Array.isArray(base) || !Array.isArray(local)) return local;
  const seen = new Set(local.map((entry) => JSON.stringify(entry)));
  return [...base.filter((entry) => !seen.has(JSON.stringify(entry))), ...local];
}

/**
 * The container path a mount lands on, in either spelling. Anonymous volumes
 * (`- /data`) name only their target.
 *
 * The `:`-split is safe for the shapes compose accepts on Linux hosts; a
 * Windows drive letter (`C:\data:/data`) would mis-split, and is not a shape
 * this platform deploys.
 */
function mountTarget(entry: JsonValue): string | null {
  if (typeof entry === "string") {
    const parts = entry.split(":");
    return (parts.length === 1 ? parts[0] : parts[1]) ?? null;
  }
  if (isObj(entry) && typeof entry.target === "string") return entry.target;
  return null;
}

/** Mounts merge by TARGET, not by whole entry: a service that re-mounts
 *  `/var/lib/postgresql/data` onto its own volume must replace the base's
 *  mount, not stack a second one on the same path. */
function mergeVolumes(base: JsonValue, local: JsonValue): JsonValue {
  if (!Array.isArray(base) || !Array.isArray(local)) return local;
  const overridden = new Set(
    local.flatMap((entry) => {
      const target = mountTarget(entry);
      return target === null ? [] : [target];
    }),
  );
  return [...base.filter((entry) => !overridden.has(mountTarget(entry) ?? "")), ...local];
}

function mergeMapping(base: Obj, local: Obj): Obj {
  const out: Obj = { ...base };
  for (const [key, value] of Object.entries(local)) {
    if (value === undefined) continue;
    const existing = out[key];
    if (existing === undefined) {
      out[key] = value;
      continue;
    }
    if (KEY_VALUE.has(key)) out[key] = mergeKeyValues(existing, value);
    else if (isObj(existing) && isObj(value)) out[key] = mergeMapping(existing, value);
    else out[key] = value;
  }
  return out;
}

/** The spec's per-key rules. Anything not named is a scalar or a
 *  replace-wholesale option (`image`, `command`, `entrypoint`, `env_file`, …),
 *  where the local value simply wins. */
function mergeValue(key: string, base: JsonValue, local: JsonValue): JsonValue {
  if (key === "volumes") return mergeVolumes(base, local);
  if (KEY_VALUE.has(key)) return mergeKeyValues(base, local);
  if (CONCATENATED.has(key)) return concatUnique(base, local);
  if (MERGED_MAPPINGS.has(key)) {
    if (isObj(base) && isObj(local)) return mergeMapping(base, local);
    if (Array.isArray(base) && Array.isArray(local)) return concatUnique(base, local);
    return local;
  }
  return local;
}

/** Apply `local` over an already-resolved `base`. */
function mergeService(base: Obj, local: Obj): Obj {
  const out: Obj = {};
  for (const [key, value] of Object.entries(base)) {
    if (key === "extends" || NEVER_INHERITED.has(key)) continue;
    if (value !== undefined) out[key] = value;
  }
  for (const [key, value] of Object.entries(local)) {
    if (key === "extends" || value === undefined) continue;
    const existing = out[key];
    out[key] = existing === undefined ? value : mergeValue(key, existing, value);
  }
  return out;
}

/** The `{ service, file? }` a service extends, in either spelling. `undefined`
 *  when the service extends nothing. */
function readExtends(svc: Obj): Result<{ service: string; file?: string } | undefined, string> {
  const raw = svc.extends;
  if (raw === undefined || raw === null) return Result.ok(undefined);
  if (typeof raw === "string") return Result.ok({ service: raw });
  if (!isObj(raw)) return Result.err("`extends` must be a service name or a mapping");
  if (typeof raw.service !== "string" || raw.service === "") {
    return Result.err("`extends` must name a `service`");
  }
  if (raw.file === undefined || raw.file === null) return Result.ok({ service: raw.service });
  if (typeof raw.file !== "string") return Result.err("`extends.file` must be a path");
  return Result.ok({ service: raw.service, file: raw.file });
}

/**
 * Every compose document reachable from the root, keyed by path relative to
 * the root file's directory ("" is the root document itself). Sibling files are
 * parsed on demand and cached, so a base file shared by twenty services is read
 * once.
 */
class DocumentSet {
  private readonly parsed = new Map<string, Obj>();

  constructor(
    rootServices: Obj,
    private readonly files: Record<string, string>,
  ) {
    this.parsed.set("", rootServices);
  }

  /** The `services` map of the document at `path`. */
  servicesAt(path: string): Result<Obj, string> {
    const cached = this.parsed.get(path);
    if (cached) return Result.ok(cached);

    const text = this.files[path];
    if (text === undefined) {
      return Result.err(
        `extends the file "${path}", which was not provided alongside this compose file`,
      );
    }
    const doc = Result.try((): unknown => parseYaml(text, { merge: true }));
    if (doc.isErr()) return Result.err(`extends "${path}", which is not valid YAML`);
    if (!isObj(doc.value) || !isObj(doc.value.services)) {
      return Result.err(`extends "${path}", which has no \`services\` map`);
    }
    this.parsed.set(path, doc.value.services);
    return Result.ok(doc.value.services);
  }
}

/**
 * Resolve one service to its fully merged form.
 *
 * `trail` is the chain of `path\0service` keys currently being resolved. It
 * doubles as the cycle detector: a base that extends back into its own chain
 * would otherwise recurse until the stack blew, and a stack overflow is not a
 * diagnosis anyone can act on.
 */
function resolveService(
  docs: DocumentSet,
  path: string,
  name: string,
  trail: string[],
): Result<Obj, string> {
  const key = `${path}\0${name}`;
  if (trail.includes(key)) {
    return Result.err(`service "${name}" extends itself, directly or through another service`);
  }

  const services = docs.servicesAt(path);
  if (services.isErr()) return services;
  const svc = services.value[name];
  if (svc === undefined) {
    return Result.err(
      path === ""
        ? `extends "${name}", which this file does not define`
        : `extends "${name}", which "${path}" does not define`,
    );
  }
  if (!isObj(svc)) return Result.err(`extends "${name}", which is not a mapping`);

  const target = readExtends(svc);
  if (target.isErr()) return Result.err(target.error);
  if (target.value === undefined) return Result.ok(svc);

  const basePath =
    target.value.file === undefined ? path : joinPath(dirOf(path), target.value.file);
  const base = resolveService(docs, basePath, target.value.service, [...trail, key]);
  if (base.isErr()) return base;
  return Result.ok(mergeService(base.value, svc));
}

/**
 * Resolve `extends` across every service in the root document.
 *
 * Returns the services map unchanged (same reference) when nothing extends
 * anything, so the overwhelmingly common case costs one scan and no copying.
 */
export function resolveExtends(
  rootServices: Obj,
  files: Record<string, string>,
): Result<Obj, ComposeExtendsError> {
  const extending = Object.entries(rootServices).filter(
    ([, svc]) => isObj(svc) && svc.extends !== undefined && svc.extends !== null,
  );
  if (extending.length === 0) return Result.ok(rootServices);

  const docs = new DocumentSet(rootServices, files);
  const out: Obj = { ...rootServices };
  for (const [name] of extending) {
    const resolved = resolveService(docs, "", name, []);
    if (resolved.isErr()) {
      return Result.err(new ComposeExtendsError(`Service "${name}" ${resolved.error}`));
    }
    out[name] = resolved.value;
  }
  return Result.ok(out);
}

/**
 * Paths this document's services pull in via `extends: { file }`, relative to
 * the document's own directory.
 *
 * Exported for callers that have a real tree to read from (the builder, from a
 * git checkout): they need to know WHICH files to load before they can call
 * `parseCompose` with them, and a base file may itself extend a third, so the
 * walk is driven one document at a time.
 */
export function extendsFileRefs(yaml: string): string[] {
  const doc = Result.try((): unknown => parseYaml(yaml, { merge: true }));
  if (doc.isErr() || !isObj(doc.value) || !isObj(doc.value.services)) return [];
  const out = new Set<string>();
  for (const svc of Object.values(doc.value.services)) {
    if (!isObj(svc)) continue;
    const target = readExtends(svc);
    if (target.isOk() && target.value?.file !== undefined) out.add(target.value.file);
  }
  return [...out];
}

/** Resolve a sibling path the same way `resolveExtends` does, so a caller
 *  loading files off disk keys them exactly as lookup will spell them. */
export function resolveSiblingPath(fromFile: string, ref: string): string {
  return joinPath(dirOf(fromFile), ref);
}
