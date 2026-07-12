# React Doctor — Full Diagnosis (apps/web)

- **Tool**: react-doctor v0.7.6
- **Score**: **20/100 (Critical)**
- **Total issues**: 657 (150 errors, 507 warnings) across 258 files
- **Raw logs**: `full-diagnosis.log` (verbose, all locations) · `report.json` (structured) · `dump/` (full diagnostics)

## Category totals

- **Maintainability**: 281 (0 err, 281 warn)
- **Bugs**: 215 (83 err, 132 warn)
- **Performance**: 133 (66 err, 67 warn)
- **Accessibility**: 27 (0 err, 27 warn)
- **Security**: 1 (1 err, 0 warn)

## Every rule that fired (issue candidates)

| Category | Rule | Count | Err | Warn | Files | What it means |
|---|---|--:|--:|--:|--:|---|
| Bugs | `complexity` | 31 | 31 | 0 | 10 | function `deriveComposeFlags` has a complexity of 19. Maximum allowed  |
| Performance | `refs` | 30 | 30 | 0 | 2 | This component misses React Compiler's automatic memoization & re-rend |
| Performance | `set-state-in-effect` | 20 | 20 | 0 | 18 | This component misses React Compiler's automatic memoization & re-rend |
| Bugs | `no-ref-current-in-render` | 19 | 19 | 0 | 6 | This ref is mutated during render. React can replay or discard render  |
| Bugs | `max-lines-per-function` | 15 | 15 | 0 | 7 | The function `ShortTextCell` has too many lines (161). Maximum allowed |
| Performance | `todo` | 12 | 12 | 0 | 11 | This component misses React Compiler's automatic memoization & re-rend |
| Bugs | `max-lines` | 8 | 8 | 0 | 8 | File has too many lines (310). |
| Bugs | `effect-needs-cleanup` | 5 | 5 | 0 | 4 | `addEventListener` creates a subscription in a function that outlives  |
| Bugs | `no-impure-state-updater` | 5 | 5 | 0 | 3 | This state updater performs the nested state update "setActiveId()". R |
| Performance | `incompatible-library` | 2 | 2 | 0 | 2 | This component misses React Compiler's automatic memoization & re-rend |
| Security | `artifact-secret-leak` | 1 | 1 | 0 | 1 | A browser-delivered artifact contains a secret-looking credential valu |
| Performance | `use-memo` | 1 | 1 | 0 | 1 | This component misses React Compiler's automatic memoization & re-rend |
| Performance | `no-layout-property-animation` | 1 | 1 | 0 | 1 | This stutters because animating "height" makes the browser redo page l |
| Maintainability | `react-compiler-no-manual-memoization` | 154 | 0 | 154 | 66 | This `useMemo` is dead weight, since React Compiler already caches eve |
| Bugs | `exhaustive-deps` | 49 | 0 | 49 | 18 | `allRows` is rebuilt every render, so `useMemo` runs every time. |
| Maintainability | `only-export-components` | 47 | 0 | 47 | 28 | This file exports non-components, so Fast Refresh can't safely preserv |
| Maintainability | `unused-file` | 34 | 0 | 34 | 34 | Unused file is not reachable from any entry point, so it adds maintena |
| Performance | `js-combine-iterations` | 26 | 0 | 26 | 22 | This loops over your list twice because .filter().map() makes two pass |
| Bugs | `no-array-index-as-key` | 25 | 0 | 25 | 24 | Your users can see & submit the wrong data when this list reorders or  |
| Bugs | `no-unused-vars` | 19 | 0 | 19 | 13 | Identifier 'Spinner' is imported but never used. |
| Maintainability | `no-many-boolean-props` | 16 | 0 | 16 | 8 | Component "ComposeWizardBody" takes 4 on/off props (hasVars, showNext, |
| Accessibility | `label-has-associated-control` | 13 | 0 | 13 | 5 | Screen reader users can't tell which input this label names because it |
| Maintainability | `prefer-module-scope-pure-function` | 10 | 0 | 10 | 10 | `start` inside `SocialSignIn` uses no local state but is rebuilt on ev |
| Maintainability | `unused-export` | 9 | 0 | 9 | 8 | Unused export: `ProjectChip` is exported but no module imports it, so  |
| Bugs | `prefer-vite-plus-imports` | 8 | 0 | 8 | 8 | Use 'vite-plus/test' instead of 'vitest' in Vite+ projects. |
| Performance | `rendering-svg-precision` | 8 | 0 | 8 | 8 | Your users download extra bytes for SVG d precision they can't see, so |
| Maintainability | `circular-dependency` | 7 | 0 | 7 | 1 | Circular import cycle: src/features/projects/components/new-resource/f |
| Performance | `js-tosorted-immutable` | 6 | 0 | 6 | 5 | This wastes work because [...array].sort() copies the array just to so |
| Performance | `js-set-map-lookups` | 6 | 0 | 6 | 6 | This scales poorly because `array.includes()` inside a loop scans the  |
| Accessibility | `control-has-associated-label` | 6 | 0 | 6 | 6 | Blind users can't tell what this control does because screen readers f |
| Performance | `prefer-dynamic-import` | 6 | 0 | 6 | 5 | "@codemirror/view" ships extra code to your users up front & slows pag |
| Bugs | `no-chain-state-updates` | 4 | 0 | 4 | 4 | Chaining state updates triggers an extra render each step. |
| Performance | `async-await-in-loop` | 4 | 0 | 4 | 4 | This makes the for…of loop slow because each await runs one after anot |
| Performance | `rerender-lazy-state-init` | 4 | 0 | 4 | 3 | useState(map()) re-runs map() on every render & throws the result away |
| Accessibility | `prefer-tag-over-role` | 4 | 0 | 4 | 4 | Screen reader users get more reliable semantics from `<button>` than ` |
| Performance | `js-flatmap-filter` | 3 | 0 | 3 | 3 | This loops over your list twice because .map().filter(Boolean) makes t |
| Bugs | `no-base-to-string` | 3 | 0 | 3 | 2 | 'v ?? ""' will use Object's default stringification format ('[object O |
| Bugs | `no-deprecated` | 3 | 0 | 3 | 1 | `FormEvent` is deprecated. FormEvent doesn't actually exist. |
| Bugs | `restrict-template-expressions` | 3 | 0 | 3 | 1 | Invalid type used in template literal expression. |
| Bugs | `no-new-array` | 2 | 0 | 2 | 2 | Do not use `new Array(singleArgument)`. |
| Bugs | `prefer-use-effect-event` | 2 | 0 | 2 | 2 | Your effect re-subscribes whenever "onSelectRange" changes, even thoug |
| Maintainability | `no-multi-comp` | 2 | 0 | 2 | 1 | This file declares several components, so each component is harder to  |
| Bugs | `unbound-method` | 2 | 0 | 2 | 2 | Avoid referencing unbound methods which may cause unintentional scopin |
| Accessibility | `role-supports-aria-props` | 2 | 0 | 2 | 1 | Screen reader users get no help from `aria-invalid` because role `regi |
| Accessibility | `click-events-have-key-events` | 1 | 0 | 1 | 1 | Keyboard users can't trigger this click handler because there's no key |
| Bugs | `no-effect-chain` | 1 | 0 | 1 | 1 | Your screen redraws several times from a single action because one use |
| Bugs | `no-redundant-type-constituents` | 1 | 0 | 1 | 1 | is overridden by string in this union type. |
| Bugs | `no-adjust-state-on-prop-change` | 1 | 0 | 1 | 1 | This effect adjusts state after a prop changes, so users briefly see t |
| Accessibility | `no-autofocus` | 1 | 0 | 1 | 1 | `autoFocus` moves focus on load, which can disrupt screen reader and k |
| Bugs | `no-event-handler` | 1 | 0 | 1 | 1 | Faking an event handler with state plus a useEffect costs an extra ren |
| Bugs | `no-unused-expressions` | 1 | 0 | 1 | 1 | Expected expression to be used |
| Performance | `js-hoist-intl` | 1 | 0 | 1 | 1 | This is slow because new Intl.NumberFormat() rebuilds on every call in |
| Bugs | `no-pass-data-to-parent` | 1 | 0 | 1 | 1 | Handing data back to a parent from a useEffect costs your users an ext |
| Bugs | `no-fetch-in-effect` | 1 | 0 | 1 | 1 | fetch() inside useEffect can race, double-fire, or leak. Use a data-fe |
| Bugs | `no-rest-destructuring` | 1 | 0 | 1 | 1 | Object rest destructuring on a query will observe all changes to the q |
| Bugs | `query-destructure-result` | 1 | 0 | 1 | 1 | Spreading the whole useQuery() result reads every field, so TanStack Q |
| Bugs | `no-unstable-deps` | 1 | 0 | 1 | 1 | The result of useQuery is not referentially stable, so don't pass it d |
| Bugs | `no-floating-promises` | 1 | 0 | 1 | 1 | Promises must be awaited, add void operator to ignore. |
| Maintainability | `no-giant-component` | 1 | 0 | 1 | 1 | Component "FileCell" is over 300 lines long, which is hard to read & c |
| Performance | `js-index-maps` | 1 | 0 | 1 | 1 | This gets slow as your list grows because array.findIndex() runs insid |
| Performance | `rerender-memo-before-early-return` | 1 | 0 | 1 | 1 | This runs even when the component bails out because the useMemo builds |
| Maintainability | `no-inline-exhaustive-style` | 1 | 0 | 1 | 1 | This inline style has 8 properties, which is hard to read & rebuilds e |
| Performance | `use-lazy-motion` | 1 | 0 | 1 | 1 | Importing "motion" ships about 30 kb of extra code and slows page load |
| Bugs | `no-console` | 1 | 0 | 1 | 1 | Unexpected console statement. |
