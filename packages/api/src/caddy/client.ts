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
      console.error("[caddy:client] adapt failed: %s", text);
      return { ok: false, error: text };
    }

    const json = await response.json();
    console.log("[caddy:client] adapt ok");
    return { ok: true, json };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Caddy adapt request failed";
    console.error("[caddy:client] adapt failed: %s", msg);
    return { ok: false, error: msg };
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
