/**
 * Shared types, label maps and pure helpers for the Root Directory picker.
 * Split out of root-directory-picker.tsx to keep that file under the
 * max-lines cap; the picker + its row components import from here.
 */

import { Result } from "better-result";

export type FrameworkKind =
  | "next"
  | "nuxt"
  | "vite"
  | "remix"
  | "astro"
  | "sveltekit"
  | "react"
  | "vue"
  | "express"
  | "fastify"
  | "hono"
  | "nest"
  | "node"
  | "bun"
  | "go"
  | "python"
  | "rust"
  | "ruby"
  | "static"
  | null;

export type MonorepoKind =
  | "turbo"
  | "nx"
  | "pnpm-workspace"
  | "yarn-workspace"
  | "npm-workspace"
  | "lerna"
  | null;

// Shape of `git.inspectRepo` output. Mirrored locally so the sub-
// components below can pass it around without dragging the orpc client
// types through every prop signature.
export interface InspectResult {
  path: string;
  entries: Array<{ name: string; type: "dir" | "file" }>;
  framework: FrameworkKind;
  monorepo: MonorepoKind;
  monorepoPackages: string[];
}

export const FRAMEWORK_LABEL: Record<NonNullable<FrameworkKind>, string> = {
  next: "Next.js",
  nuxt: "Nuxt",
  vite: "Vite",
  remix: "Remix",
  astro: "Astro",
  sveltekit: "SvelteKit",
  react: "React",
  vue: "Vue",
  express: "Express",
  fastify: "Fastify",
  hono: "Hono",
  nest: "NestJS",
  node: "Node",
  bun: "Bun",
  go: "Go",
  python: "Python",
  rust: "Rust",
  ruby: "Ruby",
  static: "Static",
};

export const MONOREPO_LABEL: Record<NonNullable<MonorepoKind>, string> = {
  turbo: "Turborepo",
  nx: "Nx",
  "pnpm-workspace": "pnpm workspaces",
  "yarn-workspace": "yarn workspaces",
  "npm-workspace": "npm workspaces",
  lerna: "Lerna",
};

/** A directory entry that's conventionally hidden (dot-prefixed). */
export function isHiddenDir(name: string): boolean {
  return name.startsWith(".");
}

/**
 * The contract surfaces RATE_LIMITED as a typed oRPC error. orpc client
 * spreads the error code into the thrown error, so we key off that.
 * Fall back to a body-substring check in case the typed envelope was
 * lost in transit (older client, proxy strip, etc.).
 */
export function isRateLimitedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (code === "RATE_LIMITED") return true;
  const msg = (err as { message?: unknown }).message;
  if (typeof msg !== "string") return false;
  return /api rate limit exceeded/i.test(msg);
}

/**
 * Strip GitHub's `{"message":"…","documentation_url":"…"}` wrapper when
 * the server forwards an upstream body as-is. Keeps the picker copy
 * legible instead of dumping JSON in front of the operator.
 */
export function humanizeUpstreamMessage(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "upstream error";

  return Result.try((): unknown => JSON.parse(trimmed))
    .map((parsed) => {
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "message" in parsed &&
        typeof parsed.message === "string" &&
        parsed.message.length > 0
      ) {
        return parsed.message;
      }
      return "upstream error";
    })
    .unwrapOr("upstream error");
}
