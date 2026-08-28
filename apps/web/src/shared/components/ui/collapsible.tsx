/**
 * Collapsible — a disclosure whose panel animates to its own content height.
 *
 * Wraps Base UI's Collapsible, which measures the panel and publishes
 * `--collapsible-panel-height` on it. That variable is the whole point: it is
 * what lets a keyframe animate from `0` to a real pixel height without any JS
 * measurement in our code, and without `height: auto`, which is not animatable.
 *
 * KEYFRAMES, NOT A TRANSITION, and deliberately so. A transition would have to
 * hold `height: var(--collapsible-panel-height)` at rest, freezing the panel at
 * whatever it measured when it opened — so anything that grows inside it
 * afterwards (a nested disclosure, a row expanding) would be clipped. A
 * keyframe only applies while it runs, leaving the panel at its natural auto
 * height once open, free to grow.
 *
 * HEIGHT IS THE ONLY THING THAT ANIMATES. The content does not fade and does
 * not scale — it is simply clipped by the panel as the panel's height changes,
 * and it stays at full opacity the entire time.
 *
 * Two earlier versions faded and scaled it, and both were wrong. The first
 * used a CSS transition on its own curve, which desynced hard: the content was
 * gone in ~80ms while the box took 240ms, so the box spent most of the close
 * collapsing around nothing. The second paired it to a keyframe on the same
 * clock, which fixed the desync — and was still wrong, because a disclosure
 * does not need its content to perform. The clip alone reads correctly.
 *
 * If you are tempted to add a fade back: the reveal is already legible from
 * the height change, and anything on the content is a second thing to keep in
 * sync with the panel for no gain.
 */

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";

import { cn } from "@/shared/lib/utils";

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

function CollapsiblePanel({ className, children, ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-panel"
      className={cn(
        // The clip IS the animation: the panel's height moves, the content
        // sits still at full opacity and is revealed or covered by the edge.
        "overflow-hidden",
        "data-[closed]:animate-collapsible-up data-[open]:animate-collapsible-down",
        // Reduced motion keeps the disclosure — the state change still has to
        // be legible — and drops the travel.
        "motion-reduce:animate-none",
        className,
      )}
      {...props}
    >
      {children}
    </CollapsiblePrimitive.Panel>
  );
}

export { Collapsible, CollapsibleTrigger, CollapsiblePanel };
