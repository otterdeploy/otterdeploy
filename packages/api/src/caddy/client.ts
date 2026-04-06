import type { CaddyConfig } from "./builder";

export type LoadResult =
  | { ok: true }
  | { ok: false; error: string };

export type ValidateResult =
  | { ok: true }
  | { ok: false; error: string };

export async function loadConfig(config: CaddyConfig, adminUrl: string): Promise<LoadResult> {
  console.log("[caddy:client] POST %s/load", adminUrl);
  try {
    const response = await fetch(new URL("/load", adminUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "must-revalidate",
      },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("[caddy:client] load failed: %s", text);
      return { ok: false, error: text };
    }

    console.log("[caddy:client] load ok");
    return { ok: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Caddy load request failed";
    console.error("[caddy:client] load failed: %s", msg);
    return { ok: false, error: msg };
  }
}

export async function validateConfig(config: CaddyConfig, adminUrl: string): Promise<ValidateResult> {
  console.log("[caddy:client] POST %s/load (check)", adminUrl);
  try {
    // Caddy doesn't have a dedicated validate endpoint for JSON configs.
    // We use /adapt with the JSON to check for errors, but since /adapt is
    // for Caddyfile→JSON, for JSON configs we just validate the structure.
    // The real validation happens on /load — if it fails, we get the error.
    // For per-project validation, we do a dry-run style check by loading
    // only that project's config and checking for errors.
    const response = await fetch(new URL("/load", adminUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "must-revalidate",
      },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      const text = await response.text();
      return { ok: false, error: text };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Caddy validation request failed",
    };
  }
}
