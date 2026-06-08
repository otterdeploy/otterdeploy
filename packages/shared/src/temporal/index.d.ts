// temporal-polyfill ships its public types as the separate `temporal-spec`
// package (`export * from 'temporal-spec'`). We vendor those types as
// `./spec.d.ts` and point the runtime's type entry at them here, so the whole
// thing is self-contained with no external dependency.
export * from "./spec";
