import { createHash } from "node:crypto";
import path from "node:path";

export type ProjectCaddySnapshot = {
  projectId: string;
  environmentId?: string | null;
  httpCaddyfile: string;
  layer4Caddyfile: string;
};

export type ValidationIssue = {
  code: string;
  message: string;
};

export type ProjectClaims = {
  httpHosts: string[];
  layer4Listeners: string[];
  layer4Snis: string[];
};

type JsonRecord = Record<string, unknown>;

export function sanitizeProjectSlug(projectId: string): string {
  const value = projectId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return value.length > 0 ? value : "project";
}

export function parseCsvSet(value: string): Set<string> {
  return new Set(
    value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function buildProjectDirectory(rootDir: string, projectId: string): string {
  return path.join(rootDir, "projects", sanitizeProjectSlug(projectId));
}

export function buildRootCaddyfile(
  rootDir: string,
  snapshots: ProjectCaddySnapshot[],
  adminBind: string,
): string {
  const layer4Imports = snapshots
    .filter((snapshot) => snapshot.layer4Caddyfile.trim().length > 0)
    .map(
      (snapshot) =>
        `\t\timport ${path.join(buildProjectDirectory(rootDir, snapshot.projectId), "layer4.caddy")}`,
    );

  const httpImports = snapshots.map(
    (snapshot) =>
      `import ${path.join(buildProjectDirectory(rootDir, snapshot.projectId), "http.caddy")}`,
  );

  const lines = ["{", `\tadmin ${adminBind}`, "}", ""];

  if (layer4Imports.length > 0) {
    lines.push("layer4 {", ...layer4Imports, "}", "");
  }

  lines.push(...httpImports, "");

  return lines.join("\n");
}

export function buildLayer4Wrapper(rootDir: string, snapshot: ProjectCaddySnapshot): string {
  return [
    "{",
    "\tadmin off",
    "\tlayer4 {",
    `\t\timport ${path.join(buildProjectDirectory(rootDir, snapshot.projectId), "layer4.caddy")}`,
    "\t}",
    "}",
    "",
  ].join("\n");
}

export function buildRevision(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

export function validateProjectScope(snapshot: ProjectCaddySnapshot): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (startsWithGlobalOptionsBlock(snapshot.httpCaddyfile)) {
    issues.push({
      code: "http.global_block_forbidden",
      message: "HTTP Caddyfile cannot define a root global options block.",
    });
  }

  if (startsWithGlobalOptionsBlock(snapshot.layer4Caddyfile)) {
    issues.push({
      code: "layer4.global_block_forbidden",
      message: "Layer4 Caddyfile cannot define a root global options block.",
    });
  }

  const httpAddressIssues = validateHttpAddresses(snapshot.httpCaddyfile);
  issues.push(...httpAddressIssues);

  return issues;
}

function startsWithGlobalOptionsBlock(source: string): boolean {
  return stripLeadingComments(source).startsWith("{");
}

function stripLeadingComments(source: string): string {
  const lines = source.split("\n");
  const kept: string[] = [];

  let inBlockComment = false;
  for (const line of lines) {
    const trimmed = line.trim();

    if (inBlockComment) {
      if (trimmed.includes("*/")) {
        inBlockComment = false;
      }
      continue;
    }

    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) {
        inBlockComment = true;
      }
      continue;
    }

    kept.push(trimmed);
  }

  return kept.join("\n");
}

function validateHttpAddresses(source: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const blockLabel of extractTopLevelBlockLabels(source)) {
    const label = blockLabel.trim();
    if (!label || label.startsWith("(")) {
      continue;
    }

    const addresses = label
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    for (const address of addresses) {
      if (extractHostFromSiteAddress(address) === null) {
        issues.push({
          code: "http.hostname_required",
          message: `HTTP site address "${address}" must be hostname-based instead of a bare listener.`,
        });
      }
    }
  }

  return issues;
}

function extractTopLevelBlockLabels(source: string): string[] {
  const labels: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of source) {
    if (char === "{") {
      if (depth === 0) {
        const label = current.trim();
        if (label.length > 0) {
          labels.push(label);
        }
        current = "";
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0) {
      current += char;
    }
  }

  return labels;
}

export function extractHostFromSiteAddress(address: string): string | null {
  const trimmed = address.trim();
  if (!trimmed || trimmed.startsWith(":")) {
    return null;
  }

  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return null;
  }

  const withoutPath = trimmed.split("/")[0] ?? trimmed;
  const candidate = withoutPath.includes("://") ? withoutPath : `https://${withoutPath}`;

  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

export function extractClaimsFromHttpJson(document: unknown): ProjectClaims {
  const claims = emptyClaims();
  const root = asRecord(document);
  const apps = asRecord(root.apps);
  const http = asRecord(apps.http);
  const servers = asRecord(http.servers);

  for (const server of Object.values(servers)) {
    const serverRecord = asRecord(server);
    const routes = asArray(serverRecord.routes);
    for (const route of routes) {
      collectHttpHosts(route, claims.httpHosts);
    }
  }

  claims.httpHosts = dedupe(claims.httpHosts);
  return claims;
}

function collectHttpHosts(route: unknown, output: string[]) {
  const routeRecord = asRecord(route);
  const matches = asArray(routeRecord.match);
  for (const match of matches) {
    const matchRecord = asRecord(match);
    const hosts = asArray(matchRecord.host);
    for (const host of hosts) {
      if (typeof host === "string") {
        output.push(host.toLowerCase());
      }
    }
  }

  const handles = asArray(routeRecord.handle);
  for (const handle of handles) {
    const handleRecord = asRecord(handle);
    const subroutes = asArray(handleRecord.routes);
    for (const subroute of subroutes) {
      collectHttpHosts(subroute, output);
    }
  }
}

export function extractClaimsFromLayer4Json(document: unknown): ProjectClaims {
  const claims = emptyClaims();
  const root = asRecord(document);
  const apps = asRecord(root.apps);
  const layer4 = asRecord(apps.layer4);
  const servers = asRecord(layer4.servers);

  for (const server of Object.values(servers)) {
    const serverRecord = asRecord(server);

    for (const listen of asArray(serverRecord.listen)) {
      if (typeof listen === "string") {
        claims.layer4Listeners.push(listen.toLowerCase());
      }
    }

    collectLayer4Sni(serverRecord.routes, claims.layer4Snis);
  }

  claims.layer4Listeners = dedupe(claims.layer4Listeners);
  claims.layer4Snis = dedupe(claims.layer4Snis);
  return claims;
}

function collectLayer4Sni(routesValue: unknown, output: string[]) {
  for (const route of asArray(routesValue)) {
    const routeRecord = asRecord(route);
    for (const match of asArray(routeRecord.match)) {
      const matchRecord = asRecord(match);
      const tls = asRecord(matchRecord.tls);

      for (const sni of asArray(tls.sni)) {
        if (typeof sni === "string") {
          output.push(sni.toLowerCase());
        }
      }

      for (const httpMatcher of asArray(matchRecord.http)) {
        const httpRecord = asRecord(httpMatcher);
        for (const host of asArray(httpRecord.host)) {
          if (typeof host === "string") {
            output.push(host.toLowerCase());
          }
        }
      }
    }

    for (const handle of asArray(routeRecord.handle)) {
      const handleRecord = asRecord(handle);
      collectLayer4Sni(handleRecord.routes, output);
    }
  }
}

export function mergeClaims(...claimsList: ProjectClaims[]): ProjectClaims {
  const merged = emptyClaims();

  for (const claims of claimsList) {
    merged.httpHosts.push(...claims.httpHosts);
    merged.layer4Listeners.push(...claims.layer4Listeners);
    merged.layer4Snis.push(...claims.layer4Snis);
  }

  merged.httpHosts = dedupe(merged.httpHosts);
  merged.layer4Listeners = dedupe(merged.layer4Listeners);
  merged.layer4Snis = dedupe(merged.layer4Snis);
  return merged;
}

export function validateClaimConflicts(
  snapshot: ProjectCaddySnapshot,
  claims: ProjectClaims,
  allClaims: Map<string, ProjectClaims>,
  reservedHosts: Set<string>,
  reservedLayer4Ports: Set<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const host of claims.httpHosts) {
    if (reservedHosts.has(host)) {
      issues.push({
        code: "http.reserved_host",
        message: `HTTP host "${host}" is reserved by otterstack.`,
      });
    }

    const owner = findClaimOwner(snapshot.projectId, allClaims, (value) =>
      value.httpHosts.includes(host),
    );
    if (owner) {
      issues.push({
        code: "http.host_conflict",
        message: `HTTP host "${host}" is already claimed by project "${owner}".`,
      });
    }
  }

  for (const sni of claims.layer4Snis) {
    if (reservedHosts.has(sni)) {
      issues.push({
        code: "layer4.reserved_sni",
        message: `Layer4 SNI host "${sni}" is reserved by otterstack.`,
      });
    }

    const owner = findClaimOwner(snapshot.projectId, allClaims, (value) =>
      value.layer4Snis.includes(sni),
    );
    if (owner) {
      issues.push({
        code: "layer4.sni_conflict",
        message: `Layer4 SNI host "${sni}" is already claimed by project "${owner}".`,
      });
    }
  }

  for (const listener of claims.layer4Listeners) {
    const port = extractPort(listener);
    if (port && reservedLayer4Ports.has(port)) {
      issues.push({
        code: "layer4.reserved_listener",
        message: `Layer4 listener "${listener}" uses reserved port "${port}".`,
      });
    }

    const owner = findClaimOwner(snapshot.projectId, allClaims, (value) =>
      value.layer4Listeners.includes(listener),
    );
    if (owner) {
      issues.push({
        code: "layer4.listener_conflict",
        message: `Layer4 listener "${listener}" is already claimed by project "${owner}".`,
      });
    }
  }

  return issues;
}

function findClaimOwner(
  currentProjectId: string,
  allClaims: Map<string, ProjectClaims>,
  matcher: (claims: ProjectClaims) => boolean,
): string | null {
  for (const [projectId, claims] of allClaims.entries()) {
    if (projectId !== currentProjectId && matcher(claims)) {
      return projectId;
    }
  }

  return null;
}

function extractPort(listener: string): string | null {
  const match = listener.match(/:(\d+)$/);
  return match?.[1] ?? null;
}

function emptyClaims(): ProjectClaims {
  return {
    httpHosts: [],
    layer4Listeners: [],
    layer4Snis: [],
  };
}

function asRecord(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as JsonRecord;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
