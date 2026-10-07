-- Move existing API keys off the api-key plugin's implicit default
-- budget (10 requests per 24 hours) onto the explicit one configured in
-- packages/auth/src/index.ts (API_KEY_RATE_LIMIT_MAX_REQUESTS per
-- API_KEY_RATE_LIMIT_WINDOW_MS: 600 per 60,000 ms). The plugin stamps the
-- budget onto each row at create time and enforces the row's values, so
-- changing the config alone would leave every existing key capped at ten
-- calls a day.
--
-- Only rows still carrying that old default are touched: nothing in the app
-- writes per-key limits, so any other value (or NULL, which the plugin reads
-- as "not limited") was set deliberately and is left as it is.
UPDATE "apikey"
SET "rate_limit_max" = 600,
  "rate_limit_time_window" = 60000
WHERE "rate_limit_max" = 10
  AND "rate_limit_time_window" = 86400000;
