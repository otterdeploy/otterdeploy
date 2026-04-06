export type AdaptResult =
  | { ok: true; json: unknown }
  | { ok: false; error: string };

export type LoadResult =
  | { ok: true }
  | { ok: false; error: string };

export async function adaptCaddyfile(caddyfile: string, adminUrl: string): Promise<AdaptResult> {
  console.log("[caddy:client] POST %s/adapt", adminUrl);
  try {
    const response = await fetch(new URL("/adapt", adminUrl), {
      method: "POST",
      headers: { "Content-Type": "text/caddyfile" },
      body: caddyfile,
    });

    if (!response.ok) {
      const text = await response.text();
      return { ok: false, error: text };
    }

    const json = await response.json();
    console.log("[caddy:client] adapt ok");
    return { ok: true, json };
  } catch (error) {
    console.error("[caddy:client] adapt failed: %s", error instanceof Error ? error.message : error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Caddy adapt request failed",
    };
  }
}

export async function loadCaddyfile(caddyfile: string, adminUrl: string): Promise<LoadResult> {
  console.log("[caddy:client] POST %s/load", adminUrl);
  try {
    const response = await fetch(new URL("/load", adminUrl), {
      method: "POST",
      headers: {
        "Content-Type": "text/caddyfile",
        "Cache-Control": "must-revalidate",
      },
      body: caddyfile,
    });

    if (!response.ok) {
      const text = await response.text();
      return { ok: false, error: text };
    }

    console.log("[caddy:client] load ok");
    return { ok: true };
  } catch (error) {
    console.error("[caddy:client] load failed: %s", error instanceof Error ? error.message : error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Caddy load request failed",
    };
  }
}
