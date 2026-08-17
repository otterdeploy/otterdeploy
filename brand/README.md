# otterdeploy brand

Everything visual that identifies the product, and the generator that builds it.

Open the brand sheet before using anything here:

```bash
bun --cwd brand run preview      # → http://127.0.0.1:4477/brand/preview.html
```

## The mark

A **slashed zero**. The ring is the product's own `rounded-lg` node silhouette, the same shape
the project graph draws, and the counter is the slash `DESIGN.md` names as the detail that keeps
`0` and `O` apart. It reads as the "o" of otterdeploy, a zero, and a node at once.

Two rules carry it:

- The ring is **ink** and rides `currentColor`, so the mark inherits whatever surface it lands on.
- The slash is the **only** chromatic element: Signal Blue, per DESIGN.md's One Voice Rule.

The slash runs `/`, never `\`. Reversed it reads as a prohibition sign.

## Layout

```
brand/
├── preview.html        # the brand sheet: start here
├── explorations.html   # the four concepts that lost, kept as a record
├── marks.js            # geometry for the explorations page only
├── logo/               # generated SVG masters  ← do not hand-edit
├── dist/               # generated PNGs for README/docs  ← do not hand-edit
├── fonts/              # Geist woff2, vendored so rendering never hits the network
└── scripts/            # the generator
```

`brand/` is deliberately **outside the monorepo workspaces**: Playwright and fontTools are
build-time-only and have no business in the app dependency graph.

## Rebuilding

```bash
brand/scripts/build.sh
```

Four steps, all idempotent:

1. **`wordmark.py`**: shapes "otterdeploy" through HarfBuzz against Geist instanced at `wght` 600
   with `cv11`/`ss01`, and outlines it to path data. Real shaping, so the outlined lockup matches
   the live text in the app.
2. **`build_svgs.py`**: composes every SVG in `logo/` from one geometry definition. **This is the
   only file to edit if the mark changes.**
3. **`rasterize.ts`**: renders the PNGs through Chromium. The favicons are consumed by browsers,
   so rasterising in a browser means what ships is what a browser draws.
4. **`make_ico.py`**: packs 16/32/48 into `favicon.ico`.

Outputs land in `brand/dist/` (docs) and `apps/web/public/` (the app). Both are generated.
Editing them by hand gets your work overwritten on the next build.

## Using it in the app

Import the component; never inline the SVG:

```tsx
import { OtterdeployLogo, OtterdeployMark } from "@/shared/components/brand/otterdeploy-logo";

<OtterdeployMark size={24} />            // mark alone: headers, collapsed nav
<OtterdeployLogo size={26} />            // mark + wordmark
<OtterdeployLogo size={26} markOnly />   // mark, sized by the lockup scale
<OtterdeployMark size={24} mono />       // single colour
```

The slash reads `--brand-accent`, defined in `apps/web/src/index.css`. It is **not** `--primary`:
the dark cut of `--primary` only reaches 2.1:1 on the dark canvas, fine behind white button text,
unreadable as a standalone mark. Light uses Signal Blue proper, dark borrows the brighter sidebar
cut. `build_svgs.py` bakes the same pair into the static assets; change one, change both.

## Colour and contrast

| Role                 | Light     | Dark      | On its canvas    |
| -------------------- | --------- | --------- | ---------------- |
| Ring / wordmark      | `#141412` | `#f5f5f0` | 18.6:1 · 17.4:1  |
| Slash (Signal Blue)  | `#1d4ed8` | `#3b82f6` | 7.3:1 · 5.8:1    |
| Canvas               | `#fbfbfa` | `#0c0c0b` |: |

## Constraints

- **Minimum size 16px.** Below that the ring and slash merge; use the wordmark alone.
- **Clear space** is one ring-corner radius (¼ of the mark) on every side.
- **Wordmark** is Geist Semibold at −0.025em. No other family, no other weight.
- Don't fill the ring, shadow it, recolour the slash, or seat the mark on a coloured tile in-product.
