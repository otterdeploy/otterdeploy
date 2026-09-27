---
name: engineer-ui-colour-and-depth
description: "Load when an agent must create an accessible palette, theme, elevation model, or functional surface treatment."
---

## Operating sequence

- Define each colour’s job before choosing its value: surface, text, border, accent, interaction, semantic state, data encoding, or image treatment. Remove colours justified only as decoration. Add new colours only for unmet functional roles, then consolidate near-duplicates into tokens. ([palette discipline](https://www.youtube.com/watch?v=EcbgbKtOELY&t=295s)) ([colour audit](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=16s))

- Start with one primary hue when the product has no established palette. Add independent hue families only when the interface genuinely requires them, such as categorical data or white-label themes. ([palette discipline](https://www.youtube.com/watch?v=EcbgbKtOELY&t=295s))

- Map roles before values: canvas, surfaces, text tiers, borders, primary accent, interaction states, focus, success, warning, error, information, destructive action, and data series. Let semantic meaning override brand consistency. ([semantic colour](https://www.youtube.com/watch?v=66oOi9OLMCw&t=274s))

- Validate every text, icon, control boundary, and meaningful mark against its final background while selecting colours—not after building the screens. Reject combinations that miss the applicable WCAG threshold. ([colour distribution](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=16s)) ([palette expansion](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=156s))

- Recheck the entire hierarchy after every palette correction; a change that fixes competition may introduce dominance, contrast, or semantic problems elsewhere. ([colour distribution](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=16s))

- Store all colours, states, surfaces, and shadows as named tokens. Ship a reconstructable style guide instead of leaving values buried in individual layers. ([tinted neutrals](https://www.youtube.com/watch?v=66oOi9OLMCw&t=339s)) ([prototype UI](https://www.youtube.com/watch?v=NtZeYmTMuo4&t=0s))

## Control colour by role and area

- Treat colour distribution as an area problem, not a swatch-count problem. Use broad low-chroma regions as visual breathing room and spend saturation where attention should land. ([colour distribution](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=87s))

- For dense product UI, begin near 90% dominant neutral, 8% secondary neutral, and 2% or less accent. Accept screens with no accent when nothing requires emphasis. This is independently supported as a product-specific correction to generic colour-ratio advice. Fails when colour itself carries categories, media, or workflow meaning. ([product palette](https://www.youtube.com/watch?v=66oOi9OLMCw&t=0s))

- Treat 60–30–10 as a loose composition heuristic when three colours all carry visual weight, especially in marketing or brand-led sections. Do not force it onto dense applications; the tension is contextual, not a ratio to average. ([colour distribution](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=16s)) ([product palette](https://www.youtube.com/watch?v=66oOi9OLMCw&t=0s))

- Match chroma and visual weight to hierarchy. Never spend the loudest colour on a low-priority element unless that element is the intended focal point. ([colour distribution](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=16s))

- Use at most one decorative accent within a sibling group. Permit multiple hues only when they encode categories or statuses users must distinguish. ([colour distribution](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=16s))

- Render icons in the surrounding text or neutral colour by default. Colour an icon only when hue communicates state, selection, category, or identity. ([colour distribution](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=16s))

- Allow a restrained layout more expressive colour than a dense layout; sparse structure leaves more attention available for chromatic character. Fails when added colour undermines functional hierarchy. ([Mac themes](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=294s))

## Build systematic ramps

- Define every reusable accent as a numbered tonal ramp—roughly 50 through 900 or 950—and reference steps rather than one-off hex values. Include enough steps for text, fills, links, hover, pressed, disabled, and both themes. ([product ramps](https://www.youtube.com/watch?v=66oOi9OLMCw&t=131s)) ([palette discipline](https://www.youtube.com/watch?v=EcbgbKtOELY&t=295s))

- Generate the ramp once with a capable palette tool, then let both themes select from that common source. Treat ordinary palette generators as sampling aids, not finished specifications. Fails when cherry-picking from an already tested system ramp would destroy its relationships. ([product ramps](https://www.youtube.com/watch?v=66oOi9OLMCw&t=131s)) ([palette exploration](https://www.youtube.com/watch?v=6CC8lLnqa28&t=46s))

- Use OKLCH for transformations that must preserve perceived lightness across hues. Use HSB for quick, comprehensible axis-based exploration, but never assume HSB brightness predicts contrast. Convert final values into the implementation format only at handoff. ([tinted neutrals](https://www.youtube.com/watch?v=66oOi9OLMCw&t=339s)) ([HSB derivation](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=181s))

- Avoid choosing colours habitually from the fully bright, fully saturated corner of an HSB picker. Explore mid-lightness and mid-saturation regions unless the brief explicitly calls for neon, arcade, children’s, or high-energy colour. ([palette exploration](https://www.youtube.com/watch?v=6CC8lLnqa28&t=46s))

- When no useful hue emerges from a picker, sample photographs, natural scenes, or existing artwork. Record useful discoveries for later rather than forcing invention during a live project. ([palette exploration](https://www.youtube.com/watch?v=6CC8lLnqa28&t=46s))

- Start beginners or highly constrained work with a neutral family and one accent, but treat that constraint as temporary. Fails when the same formula is imposed on every later brief regardless of content. ([palette exploration](https://www.youtube.com/watch?v=6CC8lLnqa28&t=46s))

- Use a generator-selected base when no brand or accessibility constraint determines one. Do not stall while searching for an inspired starting swatch. ([HSB derivation](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=181s))

- For a quick three-tone HSB family, keep hue fixed and repeatedly apply about `saturation +20` and `brightness -10`. Rescale the increments when saturation or brightness approaches its limit. ([HSB derivation](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=181s))

- Optionally rotate each darker HSB tone about 20° toward blue or purple to reinforce depth; compare shifted and unshifted versions side by side. This is a taste-sensitive refinement, not a universal requirement, and fails when the shift makes the result read as a different hue family. ([HSB derivation](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=181s))

- Remember that hue affects perceived brightness: blues and purples tend to read darker than yellows and reds at similar numeric brightness. Never equate equal channel values with equal visual weight. ([HSB derivation](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=181s)) ([semantic colour](https://www.youtube.com/watch?v=66oOi9OLMCw&t=274s))

- Encode derivations as repeatable numeric transforms, then inspect and gamut-check their outputs. Do not disguise eyeballed exceptions as a systematic ramp. ([HSB derivation](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=181s))

## Tint neutrals deliberately

- Derive a themed neutral ramp from an already working neutral scale in OKLCH: reduce each step’s lightness by about `0.03`, add about `0.02` chroma, and set the theme hue. Apply the transform once to neutrals, not repeatedly to saturated colours. ([tinted neutrals](https://www.youtube.com/watch?v=66oOi9OLMCw&t=339s))

- Keep neutral chroma low enough that the result still reads as a surface, border, or text neutral. Fails when the tint becomes foreground colour and competes with content. ([tinted neutrals](https://www.youtube.com/watch?v=66oOi9OLMCw&t=339s))

- Keep lightness and chroma transforms stable across theme variants and vary hue as the primary theme input. Manually trim chroma where fixed values make yellows or greens appear stronger or leave the display gamut. ([tinted neutrals](https://www.youtube.com/watch?v=66oOi9OLMCw&t=339s))

- Derive backgrounds and near-black text from the primary hue when subtle brand cohesion is useful. Fails when tinting reduces contrast, contaminates semantic colours, or makes the canvas visibly coloured. ([palette discipline](https://www.youtube.com/watch?v=EcbgbKtOELY&t=295s))

- Prefer off-white and tinted near-black over literal `#FFF` and `#000` for ordinary product surfaces. Preserve the extremes as scarce hierarchy or accessibility tools rather than banning them absolutely. Fails in high-contrast modes, e-ink, print, or deliberately pure-white surface systems. ([colour basics](https://www.youtube.com/watch?v=Lp6ey4AyDzA&t=175s)) ([text hierarchy](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=247s)) ([HSB interfaces](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=408s))

- Treat an entirely neutral brand palette as complete when restraint serves the product. Add semantic colours over it as functional signals. Fails when category differentiation or memorable hue ownership is commercially important. ([product ramps](https://www.youtube.com/watch?v=66oOi9OLMCw&t=131s)) ([semantic colour](https://www.youtube.com/watch?v=66oOi9OLMCw&t=274s))

## Engineer light-mode surfaces

- Budget enough neutral tokens for the product’s actual nesting: typically four background roles, one or two strokes, and three text tiers before chart and interaction colours. Marketing pages may need only three to five neutrals. ([product surfaces](https://www.youtube.com/watch?v=66oOi9OLMCw&t=27s))

- Keep each rendered screen to a small visible depth ladder: canvas, foreground surface, and at most one nested filled level. Use borders, spacing, or grouping past that point even if the global token set contains more steps. ([surface hierarchy](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=87s))

- Choose one light-mode surface model and use it consistently: darker canvas with lighter cards, lighter canvas with darker cards, or evenly stepped monochromatic layers. Do not mix elevation directions within one product. ([product surfaces](https://www.youtube.com/watch?v=66oOi9OLMCw&t=27s))

- Default to a slightly grey or tinted canvas with lighter near-white content surfaces. Reserve pure white for surfaces that need headroom above the canvas. Fails when cards are intentionally darker, a compressed all-white system is established, or a marketing background is itself the content. ([product surfaces](https://www.youtube.com/watch?v=66oOi9OLMCw&t=27s)) ([surface hierarchy](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=87s))

- Make large persistent chrome only slightly darker than the canvas—about a 2% lightness difference may suffice because large areas amplify subtle contrast. Fails for small elements and dark mode, where the same delta can disappear. ([product surfaces](https://www.youtube.com/watch?v=66oOi9OLMCw&t=27s))

- Reuse the frame neutral for darker cards when following a darker-card surface model; this keeps the material system compact and coherent. ([product surfaces](https://www.youtube.com/watch?v=66oOi9OLMCw&t=27s))

- Fix a washed-out card by increasing the lightness difference between it and its parent before adding a shadow. Use a shadow only when actual elevation still needs expression. ([product surfaces](https://www.youtube.com/watch?v=66oOi9OLMCw&t=27s))

- Use a low-contrast light-grey hairline—approximately an 85%-white region in the cited model—to define card edges without turning them into dark boxes. Increase boundary contrast only when accessibility or weak grouping cues require it. ([product surfaces](https://www.youtube.com/watch?v=66oOi9OLMCw&t=27s))

- Replace a third or fourth nested fill with a 1px border. Fails when outlining many dense adjacent boxes creates more noise than a single surface or stronger spacing. ([surface hierarchy](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=87s)) ([prototype UI](https://www.youtube.com/watch?v=NtZeYmTMuo4&t=0s))

- Consider a compressed system of white plus two or three off-whites when building a calm, minimal dashboard; carry separation through borders and typography. Treat this as a deliberate alternative to larger value steps, not a universal default. Fails when zones require strong at-a-glance distinction. ([prototype UI](https://www.youtube.com/watch?v=NtZeYmTMuo4&t=0s))

- Use a brighter small surface, such as a white search field on a slightly darker canvas, to identify a discrete control. Do not invert large panels this way; at large scale the brighter region becomes the perceived background. ([surface hierarchy](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=87s))

- Replace selected white surfaces with coordinated off-whites when an otherwise sound layout feels sterile. Fails when the extra values blur hierarchy, reduce contrast, or conflict with the system. ([depth treatments](https://www.youtube.com/watch?v=ulSOdTgoGeY&t=304s))

## Set text, borders, and action hierarchy

- Build light-mode text hierarchy from three well-separated tiers: near-black headings, slightly lighter body text, and muted supporting text. As a starting point, the cited model places them near 11%, 15–20%, and 30–40% white respectively. Darken small secondary text whenever contrast fails. ([product surfaces](https://www.youtube.com/watch?v=66oOi9OLMCw&t=27s))

- Assign text colour by rank: primary content darkest, metadata mid-dark, tertiary labels lighter. Never demote text below the contrast floor; ordinary body-sized secondary text still needs the applicable AA ratio. ([text hierarchy](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=247s))

- Use very dark grey or a subtly brand-tinted near-black for ordinary light-mode text instead of pure black. Fails when maximum contrast is explicitly required. ([text hierarchy](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=247s))

- Keep borders and dividers light, and lighten or remove them when spacing, alignment, or background already communicates grouping. Preserve stronger boundaries where they are the only grouping cue. ([text hierarchy](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=247s))

- Encode neutral button priority monotonically: ghost or text treatments at the light end, ordinary controls around light neutral steps, and a near-black fill with white text for the single primary action. ([product surfaces](https://www.youtube.com/watch?v=66oOi9OLMCw&t=27s))

- Permit only one primary call to action within a local region such as a header. First question whether adjacent secondary actions can be removed; if retained, remove their fill or reduce their weight. Independent sections may each have a primary action. ([colour basics](https://www.youtube.com/watch?v=Lp6ey4AyDzA&t=175s))

- In a destructive confirmation, give the filled treatment to the destructive action when it is the dialog’s purpose, colour it red, and keep cancel visually secondary. ([colour basics](https://www.youtube.com/watch?v=Lp6ey4AyDzA&t=175s))

## Apply accent and semantic colour

- Use a mid-ramp accent—commonly 500 or 600—as the light-mode default and lighter steps around 400–500 for inline links when contrast permits. Derive every use from tokens rather than ad hoc darkening. ([product ramps](https://www.youtube.com/watch?v=66oOi9OLMCw&t=131s))

- Lighten and desaturate a brand colour into a tint when it is too dominant for a supporting surface, then use near-black text. Fails when the component is supposed to be the primary focal point. ([colour distribution](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=16s))

- Reserve independent semantic families for information, success, warning, error, progress, and destructive action. Never force these meanings through an unsuitable brand hue. ([semantic colour](https://www.youtube.com/watch?v=66oOi9OLMCw&t=274s))

- Use conventional mappings as defaults: blue for information or trust, green for success, yellow for caution, and red for danger or destruction. Never reuse those hues decoratively when doing so would weaken their meaning. Fails where brand collisions, domain conventions, or cultural interpretation demand adjustment. ([palette discipline](https://www.youtube.com/watch?v=EcbgbKtOELY&t=295s))

- Render irreversible actions in red even when red is absent from the brand palette. Add wording, an icon, isolation, and confirmation when red already means something else, the brand itself is red, or the locale interprets it differently. ([semantic colour](https://www.youtube.com/watch?v=66oOi9OLMCw&t=274s)) ([semantic actions](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=339s))

- Reserve success and danger tokens in every product palette and define them as light/dark pairs from the outset. ([semantic actions](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=339s))

- Treat destructive red as stricter than attention-only notification colour. A brand accent may replace a neutral notification badge, but critical error counts and alerts retain danger semantics. ([semantic actions](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=339s))

- Ensure meaning survives rapid scanning, then add a non-colour cue such as text, icon, pattern, or position. Colour alone never suffices for colour-blind users, greyscale contexts, or irreversible actions. ([semantic actions](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=339s))

- When a brand fill fails with required white text, choose the treatment by hierarchy: darken the hue if the component must remain prominent, or convert it to a light tint with dark text if it should recede. If neither preserves the role, use an established complementary system colour. Do not alter exact governed brand marks; move them out of text-bearing roles. ([palette expansion](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=156s)) ([colour distribution](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=16s))

- Extend incomplete brand guidelines to meet product hierarchy and accessibility needs, but seek approval under strict governance or regulated identity systems. Structure additions around one dominant hue plus a deliberate partner rather than equal competing colours. ([palette expansion](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=156s))

## Build data colours

- Do not use only neutrals or equal-lightness tints of one hue for categorical series. Reserve single-hue sequential ramps for ordered magnitude or one-series charts. ([semantic colour](https://www.youtube.com/watch?v=66oOi9OLMCw&t=274s))

- Generate categorical colours in OKLCH by holding lightness and chroma approximately constant and stepping hue about 25–30° for each swatch. Then adjust individual swatches for gamut, background contrast, and colour-vision deficiencies. ([semantic colour](https://www.youtube.com/watch?v=66oOi9OLMCw&t=274s))

- Add related categorical colours by rotating a brand hue modestly in both directions rather than varying opacity alone. Use opacity or lightness within one hue only when encoding ordered intensity. ([palette expansion](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=156s))

- Use analogous neighbours for cohesion and reserve a complement for the one series or action that must stand out. Fails when the complement occupies equal area and becomes a competing identity. ([palette expansion](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=156s))

- Prefer nameable relationships—analogous neighbours, complement, or semantic convention—over arbitrary additions. Let domain semantics override colour-wheel geometry. ([palette expansion](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=156s))

## Derive interaction states

- Keep default values visually restrained and reserve stronger fill or colour for meaningful state differences. **Fails when:** Restrained defaults still need readable contrast and recognizable affordances. ([scannable-ui](https://www.youtube.com/watch?v=neE6wOuBIP8&t=365s))
- Reduce competing emphasis around an important value before making that value more saturated or bold. **Fails when:** A critical alert can still need explicit emphasis when surrounding content cannot be subdued. ([scannable-ui](https://www.youtube.com/watch?v=neE6wOuBIP8&t=365s))
- Budget at least four colour states per interactive component: rest, hover, pressed, and disabled. Add focus, selected, error, and loading states where the component needs them. ([interaction states](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=373s))

- Derive states mathematically from the component’s base colour so they remain one family. Do not assume one direction is universal: one source recommends brighter hover and darker pressed, while a ramp-specific light-mode system recommends a darker 700 hover from a 500–600 base. Judge the tension by background, component type, and perceptibility; keep pressed distinct from hover. ([interaction states](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=373s)) ([product ramps](https://www.youtube.com/watch?v=66oOi9OLMCw&t=131s))

- Desaturate disabled coloured controls and lower both fill and label contrast. For grayscale bases, use lightness instead because desaturation has no effect. Preserve native disabled semantics and explain unavailability when users need the reason. ([interaction states](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=373s))

- Test every state against every supported theme. Reverse a lighten/darken direction when a base already sits near the end of its usable range. ([interaction states](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=373s))

- Remove hover-only treatments on touch input and invest in a clear momentary pressed state. Gate hover by pointer capability rather than screen width for hybrid devices. ([interaction states](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=373s))

- Add pressed feedback even to visually flat rows and mobile text links so users can tell that the intended target registered the tap. ([interaction states](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=373s))

- Size navigation hover or selected backgrounds to the full row and place them behind both icon and label, creating a stable hit area independent of label length. ([prototype UI](https://www.youtube.com/watch?v=NtZeYmTMuo4&t=0s))

- When prototyping state transitions in frame-based tools, duplicate the complete frame and change only differing properties; move to component variants when duplication becomes difficult to maintain. Animate top-level layer opacity for whole-object fades, using fill opacity only when the stroke and effects must remain visible. ([prototype UI](https://www.youtube.com/watch?v=NtZeYmTMuo4&t=0s))

## Author dark mode separately

- Build dark mode as a separate palette selected from shared role-based ramps, never as a finished mathematical inversion. An inversion may serve as a rough starting pass only. This is independently supported across multiple sources. ([product ramps](https://www.youtube.com/watch?v=66oOi9OLMCw&t=131s)) ([dark theme](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=294s)) ([Mac themes](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=294s))

- Keep semantic roles and recognisable hue families consistent across modes while re-deriving their exact lightness, chroma, and contrast. Bind the shipped theme to the operating-system preference unless the product has a justified override. ([Mac themes](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=294s))

- Increase gaps between adjacent dark surfaces to roughly 4–6% when comparable light surfaces need only about 2%. Compress light-mode values where possible, but never below accessibility thresholds. ([product ramps](https://www.youtube.com/watch?v=66oOi9OLMCw&t=131s)) ([dark theme](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=294s)) ([Mac themes](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=294s))

- Keep the page background darkest and make every genuinely elevated surface lighter. If another lightness step would exhaust the dark range, cap the elevation ladder and use a border instead. This is independently supported as the primary dark-mode depth model. ([product ramps](https://www.youtube.com/watch?v=66oOi9OLMCw&t=131s)) ([dark palette](https://www.youtube.com/watch?v=EcbgbKtOELY&t=347s)) ([dark elevation](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=449s))

- Generate tinted dark surface steps in HSB by adding roughly 4–6 brightness and subtracting roughly 10–20 saturation while holding hue fixed. Repeat the transform only for a small ordered set such as base, level 1, and level 2. Rescale it for neutral or highly saturated bases. ([dark elevation](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=449s))

- Use low-chroma tinted dark neutrals instead of default blue-grey when another base hue better fits the product. Keep one hue across the ladder and prevent chroma from distorting foreground brand or semantic colours. ([dark palette](https://www.youtube.com/watch?v=EcbgbKtOELY&t=347s))

- Give flush or inset dark-mode controls a border instead of a lighter fill so they do not masquerade as raised surfaces. ([product ramps](https://www.youtube.com/watch?v=66oOi9OLMCw&t=131s))

- Tune dark borders to the narrow window between disappearance and harsh outlining. The evidence creates a useful tension: borders often need more visibility than their light-mode equivalents, yet light strokes become aggressive on dark surfaces. Preserve non-text contrast for focus rings and load-bearing input boundaries. ([product ramps](https://www.youtube.com/watch?v=66oOi9OLMCw&t=131s)) ([dark palette](https://www.youtube.com/watch?v=EcbgbKtOELY&t=347s))

- Use light grey—not pure white—for ordinary dark-mode body text. Reserve pure white for only the few highest-priority elements and keep every lower tier above its contrast floor. ([text hierarchy](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=247s)) ([dark theme](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=294s))

- Audit each view for excessive `#000` and `#FFF`; redistribute extremes across tonal tiers when more than one or two elements consume them without a clear reason. ([text hierarchy](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=247s))

- Inspect inversions of tinted near-black values: a subtle dark purple can become conspicuously pale purple and stop functioning as neutral text. ([dark theme](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=294s))

- Re-select accents from lighter ramp steps—often 300 or 400 in dark mode—while reducing chroma enough to prevent vibration. Judge the apparent tension between “lighter accent” and “reduced brightness” by role: links and labels may move lighter, while large fills should become deeper and quieter. ([product ramps](https://www.youtube.com/watch?v=66oOi9OLMCw&t=131s)) ([dark theme](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=294s)) ([dark palette](https://www.youtube.com/watch?v=EcbgbKtOELY&t=347s))

- For dark chips and badges, use a deep muted hue as the fill and a lighter version of the same hue for the label. Keep the container quieter than surrounding primary content. ([dark palette](https://www.youtube.com/watch?v=EcbgbKtOELY&t=347s))

- Review dark surfaces, borders, text, interaction states, accents, and semantic colours independently. Do not rely on one global transform to correct all six systems. ([dark theme](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=294s))

## Model elevation and shadows

- Establish an ordered elevation model before styling individual components. Use surface value, border, shadow, position, or spacing as deliberate depth cues rather than interchangeable decoration. ([shadow system](https://www.youtube.com/watch?v=EcbgbKtOELY&t=379s))

- Treat shadows primarily as a light-mode depth tool. In dark mode, use lighter raised surfaces as the main cue; do not merely increase shadow opacity when the canvas leaves no darker headroom. ([shadow system](https://www.youtube.com/watch?v=EcbgbKtOELY&t=379s)) ([dark elevation](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=449s))

- Never ship an untouched tool-default shadow. First test removing it; keep it only when hierarchy collapses without it and no cleaner border or surface step can replace it. ([effects](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=66s)) ([effects practice](https://www.youtube.com/watch?v=Lp6ey4AyDzA&t=330s))

- Use one restrained shadow language for elevation and avoid stacking shadows, glows, and decorative gradients on the same element. Fails for a deliberately authored tactile or theatrical style. ([effects](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=66s))

- Make light-mode shadows broad and low contrast. Evidence supports two compatible tuning routes: use a light-grey shadow on near-white surfaces to avoid muddying them, or reduce black-shadow opacity and increase blur on coloured surfaces. A light-grey shadow fails on dark or photographic backgrounds, where it becomes a halo. ([effects](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=66s)) ([prototype UI](https://www.youtube.com/watch?v=NtZeYmTMuo4&t=0s)) ([shadow system](https://www.youtube.com/watch?v=EcbgbKtOELY&t=379s))

- Begin conventional shadows with horizontal offset no greater than vertical offset—ideally `x = 0`—and blur around `1.3–2×` the vertical offset. Allow wider ambient shadows or zero-blur stylistic shadows only when intentional. ([effects practice](https://www.youtube.com/watch?v=Lp6ey4AyDzA&t=330s))

- Reduce common 25% preset opacity toward roughly 15–20% on light backgrounds, then tune against the actual foreground and receiving surface. Fails when that level no longer registers or when dark-mode elevation is better expressed through surfaces. ([effects practice](https://www.youtube.com/watch?v=Lp6ey4AyDzA&t=330s)) ([shadow system](https://www.youtube.com/watch?v=EcbgbKtOELY&t=379s))

- Scale shadow strength with elevation: subtle for resting cards and stronger for popovers, dropdowns, tooltips, and modals. Never give inline cards floating-overlay shadows. ([shadow system](https://www.youtube.com/watch?v=EcbgbKtOELY&t=379s))

- Derive shadow tokens from a small set of elevation inputs and fixed ratios rather than four unrelated numbers per component. Retune variants when background lightness or tint materially changes perceived strength. ([effects practice](https://www.youtube.com/watch?v=Lp6ey4AyDzA&t=330s)) ([shadow system](https://www.youtube.com/watch?v=EcbgbKtOELY&t=379s))

- Dial back any shadow that becomes one of the first things noticed. It should communicate depth before attention, not become content. ([shadow system](https://www.youtube.com/watch?v=EcbgbKtOELY&t=379s))

- Build deliberately tactile controls with a consistent light source: an outer shadow for lift, a light top inset, and a dark bottom inset for volume. Do not use this machinery in a flat system or mix contradictory light directions. ([shadow system](https://www.youtube.com/watch?v=EcbgbKtOELY&t=379s))

- Create stronger graphic depth with a visibly offset background layer when shadow alone feels generic. Animate the offset only on pointer-capable interfaces; touch-only contexts need pressed feedback instead. ([depth treatments](https://www.youtube.com/watch?v=ulSOdTgoGeY&t=215s))

- Separate major page regions with deliberate background changes when they need distinct planes. Do not introduce region colours without a structural grouping purpose. ([depth treatments](https://www.youtube.com/watch?v=ulSOdTgoGeY&t=215s))

- Continue practising shadows and gradients in disposable studies even when removing weak effects from production work; shipping restraint and skill development are separate decisions. ([effects practice](https://www.youtube.com/watch?v=Lp6ey4AyDzA&t=330s))

## Use gradients only for a job

- Validate every layout with a flat fill first. Add a gradient only for a defined purpose such as brand identity, depth, image legibility, or content fading. ([effects](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=66s)) ([effects practice](https://www.youtube.com/watch?v=Lp6ey4AyDzA&t=330s))

- Remove a gradient or shadow before adjusting it when hierarchy survives without the effect. Replace load-bearing separation with a border, surface step, or spacing rather than simply deleting the cue. ([effects](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=66s))

- Prefer two stops from one hue at different lightness for ordinary decorative gradients. Use multi-hue gradients only when they are deliberate brand assets with controlled interpolation and midpoints. ([effects](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=66s))

## Protect text over images

- Place a contrast layer between text and any photograph whose luminance varies beneath the copy. Skip it only when the text region is a controlled, flat field that already passes contrast. ([image scrims](https://www.youtube.com/watch?v=EcbgbKtOELY&t=516s))

- Prefer a localized linear scrim that runs from transparent over the image toward sufficient opacity behind edge-anchored text. Use a uniform full-image scrim when the image is merely atmospheric or dense UI requires predictable global legibility. ([image scrims](https://www.youtube.com/watch?v=EcbgbKtOELY&t=516s))

- Extend the gradient across enough distance to avoid a visible band, and match its opaque end to the surrounding surface when the image should dissolve into the layout. Fails when no single surrounding colour exists. ([image scrims](https://www.youtube.com/watch?v=EcbgbKtOELY&t=516s))

- Add progressive background blur along the scrim’s axis only as an enhancement after the gradient establishes contrast. Omit it when performance matters or the gradient already solves legibility. ([image scrims](https://www.youtube.com/watch?v=EcbgbKtOELY&t=516s))

## Build glass as a material system

- Use dark soft glass only when its connotations—technical sophistication, AI, infrastructure, or premium tooling—fit the product. Avoid it where trust depends on familiarity and transparency, such as public services, healthcare, or novice finance. ([glass surfaces](https://www.youtube.com/watch?v=If7iCPDy2vk&t=343s))

- Build glass from five coordinated layers: low-opacity fill, subtle same-material gradient, backdrop blur, 1px bright edge, and soft inner shadow. Fails over flat backgrounds with nothing to refract or when stacking glass over glass creates haze. ([glass surfaces](https://www.youtube.com/watch?v=If7iCPDy2vk&t=343s))

- Blur what sits behind the panel, never the panel itself. Avoid backdrop blur on moving elements, long scrolling lists, or many simultaneous instances when rendering cost is material. ([glass surfaces](https://www.youtube.com/watch?v=If7iCPDy2vk&t=343s))

- Use a 1 device-independent-pixel border brighter than the fill. Test high-density rendering and large radii, where a nominal hairline may vanish or require directionally varied highlights. ([glass surfaces](https://www.youtube.com/watch?v=If7iCPDy2vk&t=343s))

- Pair the bright edge with a soft inner highlight that falls inward from the top. Omit the inner shadow on elements below roughly 40px tall, where it tends to muddy the fill. ([glass surfaces](https://www.youtube.com/watch?v=If7iCPDy2vk&t=343s))

- Keep the pane’s own gradient within a narrow value range so it reads as uneven illumination, not decoration. Place saturated gradients behind the glass and keep the panel near-neutral. Fails when dramatic backdrop hue changes make identical panels appear unrelated. ([glass surfaces](https://www.youtube.com/watch?v=If7iCPDy2vk&t=343s))

- Calibrate opacity, blur, edge brightness, and shadow toward a named material target. Use restrained, low-contrast tuning for a luxury feel; do not apply that cold aesthetic to playful or high-energy brands. ([glass surfaces](https://www.youtube.com/watch?v=If7iCPDy2vk&t=343s))

- Add at most one slow, low-contrast motion detail to a focal glass surface. Do not animate every panel or combine moving fill, gradient, and border; disable the motion under reduced-motion preferences. ([glass surfaces](https://www.youtube.com/watch?v=If7iCPDy2vk&t=343s))

- Test glass text against the lightest and darkest backdrop states that can move, scroll, or animate behind it—not against one screenshot. ([glass surfaces](https://www.youtube.com/watch?v=If7iCPDy2vk&t=343s))

## Add restrained texture

- Use subtle image texture or low-key noise only when a large open surface needs ambient character. Keep it subordinate to content and remove it if it degrades readability or becomes consciously noticeable. ([depth treatments](https://www.youtube.com/watch?v=ulSOdTgoGeY&t=304s))

## Final audit

- Verify that every visible colour has one named role and that semantic meaning overrides identity where they collide. ([semantic colour](https://www.youtube.com/watch?v=66oOi9OLMCw&t=274s))

- Verify contrast for every theme, interaction state, translucent backdrop extreme, and text-bearing image region. ([colour distribution](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=16s)) ([glass surfaces](https://www.youtube.com/watch?v=If7iCPDy2vk&t=343s))

- Verify that surface lightness communicates one consistent depth direction, especially in dark mode. ([dark elevation](https://www.youtube.com/watch?v=c1TvOcKdBVE&t=449s))

- Verify that secondary text, disabled controls, subtle borders, and dark-mode accents remain legible without becoming dominant. ([interaction states](https://www.youtube.com/watch?v=EOcY3hPMQkk&t=373s)) ([Mac themes](https://www.youtube.com/watch?v=Vy0KKvZJRH8&t=294s))

- Verify that effects disappear into the hierarchy: remove any shadow, gradient, glass layer, texture, or motion detail that attracts attention without carrying information or depth. ([effects](https://www.youtube.com/watch?v=AH_ugxmLeUM&t=66s))
