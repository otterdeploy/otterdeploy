/**
 * The project's single entry point for the TC39 Temporal API.
 *
 * Backed by a vendored copy of `temporal-polyfill` (see `./temporal/`), so
 * there's no runtime npm dependency. Import Temporal through here rather than
 * the vendored files directly — it keeps one swap point for when the runtime
 * ships Temporal natively.
 *
 * String parsing/formatting reference:
 * https://tc39.es/proposal-temporal/docs/strings.html
 */
export { Intl, Temporal, toTemporalInstant } from "./temporal/index.js";
