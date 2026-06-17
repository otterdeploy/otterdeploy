import * as z from "zod";

import type { SessionSource } from "./types";

/**
 * Search schema for the popout terminal. A single `session` search key carries
 * an ordered list of session tokens; each token encodes one SessionSource. The
 * router serializes the array as repeated `?session=…&session=…` params so the
 * URL is human-readable and round-trippable.
 *
 * Tanstack-router gives back a single string when the URL has only one
 * `session` param and an array when there are multiple; the union+transform
 * normalizes both shapes to `string[]`.
 */
export const terminalSearchSchema = z.object({
  session: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v): string[] => (v == null ? [] : Array.isArray(v) ? v : [v])),
});

export type TerminalSearch = z.infer<typeof terminalSearchSchema>;

// Tokens are colon-delimited: `<kind>:<field>:<field>:…`. Fields in our
// SessionSource kinds (slugs, hex container ids, host names) don't contain
// colons in practice; if IPv6 hosts ever show up, switch the delimiter.
export function encodeSessionToken(source: SessionSource): string {
  switch (source.kind) {
    case "container":
      return `container:${source.project}:${source.service}:${source.replica}:${source.containerId}`;
    case "ssh":
      return `ssh:${source.mode}:${source.node}:${source.host}`;
    case "database":
      return `database:${source.engine}:${source.service}:${source.project}`;
  }
}

function decodeSessionToken(token: string): SessionSource | null {
  const parts = token.split(":");
  switch (parts[0]) {
    case "container": {
      if (parts.length !== 5) return null;
      const [, project, service, replica, containerId] = parts as [
        string,
        string,
        string,
        string,
        string,
      ];
      return { kind: "container", project, service, replica, containerId };
    }
    case "ssh": {
      if (parts.length !== 4) return null;
      const [, mode, node, host] = parts as [string, string, string, string];
      if (mode !== "local" && mode !== "remote") return null;
      return { kind: "ssh", mode, node, host };
    }
    case "database": {
      if (parts.length !== 4) return null;
      const [, engine, service, project] = parts as [string, string, string, string];
      return { kind: "database", engine, service, project };
    }
    default:
      return null;
  }
}

/** Decode all valid session tokens out of the URL, dropping malformed ones. */
export function sessionSourcesFromSearch(
  search: TerminalSearch,
): SessionSource[] {
  const out: SessionSource[] = [];
  for (const token of search.session) {
    const source = decodeSessionToken(token);
    if (source) out.push(source);
  }
  return out;
}

/** Build a URLSearchParams that opens the popout with these sessions. */
export function sessionSourcesToSearchParams(
  sources: SessionSource[],
): URLSearchParams {
  const params = new URLSearchParams();
  for (const s of sources) params.append("session", encodeSessionToken(s));
  return params;
}
