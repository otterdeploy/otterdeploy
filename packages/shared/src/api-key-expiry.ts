/**
 * The expiry range an API key may be minted with. The better-auth apiKey
 * plugin is configured from these (packages/auth) and the apiKeys.create
 * contract bounds `expiresIn` with them, so an out-of-range expiry is a typed
 * 400 naming the range instead of the plugin's APIError surfacing as an
 * untyped 500. The plugin works in days; the API in seconds.
 */
const API_KEY_MIN_EXPIRES_IN_DAYS = 1;
const API_KEY_MAX_EXPIRES_IN_DAYS = 365;

/** The plugin's `keyExpiration` bounds, in its own unit (days). */
export const API_KEY_EXPIRATION_DAYS = {
  minExpiresIn: API_KEY_MIN_EXPIRES_IN_DAYS,
  maxExpiresIn: API_KEY_MAX_EXPIRES_IN_DAYS,
};

export const API_KEY_MIN_EXPIRES_IN_SECONDS = API_KEY_MIN_EXPIRES_IN_DAYS * 86_400;
export const API_KEY_MAX_EXPIRES_IN_SECONDS = API_KEY_MAX_EXPIRES_IN_DAYS * 86_400;
