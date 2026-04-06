export type AdaptResult =
  | { ok: true; json: unknown }
  | { ok: false; error: string };

export type LoadResult =
  | { ok: true }
  | { ok: false; error: string };

export async function adaptCaddyfile(caddyfile: string, adminUrl: string): Promise<AdaptResult> {
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
    return { ok: true, json };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Caddy adapt request failed",
    };
  }
}

export async function loadCaddyfile(caddyfile: string, adminUrl: string): Promise<LoadResult> {
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

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Caddy load request failed",
    };
  }
}
