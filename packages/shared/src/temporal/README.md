# Vendored: temporal-polyfill

A self-contained copy of the [`temporal-polyfill`](https://www.npmjs.com/package/temporal-polyfill)
runtime plus its type spec. No npm dependency — consume it via
`@otterdeploy/shared/temporal`.

## Provenance

| Piece | Source | License |
| ----- | ------ | ------- |
| Runtime (`index.js`, `chunks/`) | npm `temporal-polyfill@0.3.2` | MIT |
| Types (`spec.d.ts`) | npm `temporal-spec@0.3.1` | ISC |

See `LICENSE` for the retained notices.

## What was vendored, and why only this

`temporal-polyfill`'s runtime closure for the class-based API is just three
files — `index.js` → `chunks/classApi.js` → `chunks/internal.js` — with no
dynamic imports. Its public types are re-exported wholesale from the separate
`temporal-spec` package (a single self-contained `.d.ts`), copied here as
`spec.d.ts`. `index.d.ts` re-points the runtime's type entry at it.

The functional (`fns/`), `global`, and `.cjs` builds were intentionally left
out — the monorepo is ESM and only uses the class API.

## Updating

Re-pull both packages at matching versions and recopy:

```
npm pack temporal-polyfill@<v>   # index.js, chunks/classApi.js, chunks/internal.js, LICENSE
npm pack temporal-spec@<v>       # index.d.ts -> spec.d.ts, LICENSE
```

Keep `index.d.ts` (the `export * from "./spec"` shim) as-is.
