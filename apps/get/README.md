# get.otterdeploy.com

The install edge. A Cloudflare Worker with no origin server, serving the files a
fresh host needs and the manifest running instances poll.

| URL | Serves |
| --- | --- |
| `/install.sh` | `scripts/install.sh` from the newest stable release |
| `/uninstall.sh` | `scripts/uninstall.sh` |
| `/docker-compose.yml` | **`docker-compose.prod.yml`**: the image-based stack |
| `/versions.json` | Latest-release manifest (the update-poll target) |
| `/<tag>/<file>` | That exact release, immutable: e.g. `/v0.4.2/docker-compose.yml` |
| `/<file>.sha256` | Checksum for any of the above |
| `/` | Redirects to the install docs |

Artifacts live in the `otterdeploy-get` R2 bucket and are written **only** by the
`publish-artifacts` job in `.github/workflows/images.yml`. The Worker never
writes. On an R2 miss it falls back to `raw.githubusercontent.com`, so the
documented install URL works even before the first release is published.

## Why this exists

A stable URL is half of it. The other half is that we otherwise have **no idea
how many people run otterdeploy**: GHCR publishes no pull counts and
`raw.githubusercontent.com` tells us nothing. This is the mechanism Coolify uses:
serve the installer yourself, and let running instances poll a manifest you also
serve.

Two numbers come out of the `otterdeploy_get` Analytics Engine dataset:

```sql
-- installs
SELECT count() FROM otterdeploy_get WHERE blob1 = 'install.sh' AND timestamp > now() - INTERVAL '7' DAY

-- active instances (distinct hosts polling for updates)
SELECT uniq(index1) FROM otterdeploy_get WHERE blob1 = 'versions.json' AND timestamp > now() - INTERVAL '1' DAY
```

`index1` is a truncated SHA-256 of the client IP, stable enough within a window
to deduplicate one host, never stored or reversible to an address. No telemetry
ships in the product itself, and nothing identifies an installation.

## One-time setup

```bash
bunx wrangler login
bunx wrangler r2 bucket create otterdeploy-get
bun run deploy
```

`wrangler deploy` claims `get.otterdeploy.com` as a custom domain and creates the
DNS record itself: this is what replaces the proxied-record-with-no-origin that
was returning 525.

Then add two repository secrets so CI can publish releases:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Token with **Workers R2 Storage: Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | From the Cloudflare dashboard sidebar |

## Pointing the control plane at this manifest

`versions.json` is deliberately shaped like GitHub's `releases/latest` payload
(`tag_name` / `html_url` / `body`), so the in-app updater consumes it with no
code change. See `packages/api/src/routers/system/release-source.ts`. Set on the
control plane:

```
OTTERDEPLOY_UPDATE_MANIFEST_URL=https://get.otterdeploy.com/versions.json
```

Until that is set, instances poll `api.github.com` instead and the
active-instance number stays blind.

## Local

```bash
bun run dev    # http://localhost:8787, R2 empty → exercises the GitHub fallback
bun run tail   # live logs from production
```
