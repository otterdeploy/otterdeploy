/**
 * The project's single entry point for the TC39 Temporal API.
 *
 * Backed by `temporal-polyfill`. Import Temporal through here rather than the
 * package directly: one swap point for when the runtimes ship Temporal
 * natively, and one copy of the polyfill in every bundle instead of one per
 * app that happens to pick a different package.
 *
 * `Intl` is the polyfill's Temporal-aware `Intl`: its `DateTimeFormat`
 * formats `Temporal.Instant` / `ZonedDateTime` / `Plain*` values directly.
 * `toTemporalInstant` is the bridge for a `Date` handed over by a library
 * (`toTemporalInstant.call(date)`).
 *
 * String parsing/formatting reference:
 * https://tc39.es/proposal-temporal/docs/strings.html
 */
export { Intl, Temporal, toTemporalInstant } from "temporal-polyfill";
