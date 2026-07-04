/** Platform-generated service name prefix — mirrors
 *  `config.service.serviceNamePrefix` in packages/api/src/constants.ts.
 *  EVERY image built on the control plane is named
 *  `otterdeploy-local/otterdeploy-svc-<project>-<service>:<sha>`, so the whole
 *  name portion is derivable boilerplate next to the service it belongs to. */
const PLATFORM_SVC_PREFIX = "otterdeploy-svc-";

/**
 * Shorten an image ref for display. Platform-built refs collapse to their
 * only informative token — `build <sha7>` — since the name is generated
 * (see PLATFORM_SVC_PREFIX). User-supplied refs keep their name and drop the
 * registry path + digest, with content-hash tags clipped to 7 chars:
 * `ghcr.io/acme/api:1.2.0` → `api:1.2.0`, `nginx:latest` → `nginx:latest`.
 * Show the full ref in a tooltip/title wherever this is used.
 */
export function shortImageRef(image: string): string {
  const ref = image.split("@")[0] ?? image;
  const slash = ref.lastIndexOf("/");
  const colon = ref.lastIndexOf(":");
  const repo = colon > slash ? ref.slice(0, colon) : ref;
  const tag = colon > slash ? ref.slice(colon + 1) : null;
  const name = repo.split("/").pop() ?? repo;
  const shortTag = tag && /^[0-9a-f]{12,}$/i.test(tag) ? tag.slice(0, 7) : tag;
  if (name.startsWith(PLATFORM_SVC_PREFIX) && shortTag) return `build ${shortTag}`;
  return shortTag ? `${name}:${shortTag}` : name;
}
