/**
 * Which social providers the LIVE better-auth instance has registered, held
 * outside ./index.ts so a reader can ask without importing it.
 *
 * ./public-config.ts needs this list and nothing else from the instance. Having
 * it import ./index would make the module that DESCRIBES the auth instance
 * depend on the module that BUILDS it, which is a cycle waiting to bite the
 * first time the description is needed during construction. So the list lives
 * here, ./index.ts writes to it from `reloadAuth`, and both sides read it.
 *
 * The value is what the instance ACTUALLY registered, not what the settings
 * columns claim. A provider whose secret won't decrypt is skipped during the
 * rebuild, and it must not appear as a button on the sign-in page.
 */

let liveSocialProviderIds: readonly string[] = [];

/** Provider ids the live instance has registered. The sign-in page reads this
 *  through /api/auth/public-config so it renders exactly the buttons that
 *  actually work. It used to read the build-time VITE_AUTH_SOCIAL_PROVIDERS,
 *  which meant a self-hoster running the published image could never enable
 *  SSO without rebuilding the SPA. */
export function enabledSocialProviderIds(): string[] {
  return [...liveSocialProviderIds];
}

/** Called only by `reloadAuth` (and once at module load in ./index.ts), right
 *  after the instance those ids describe becomes the live one. */
export function setEnabledSocialProviderIds(ids: readonly string[]): void {
  liveSocialProviderIds = [...ids];
}
