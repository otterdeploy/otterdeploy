import * as React from "react";
import { useLayoutEffect, useRef, useState } from "react";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { motion, type HTMLMotionProps, type Transition } from "motion/react";

import { cn } from "@/shared/lib/utils";

function Tabs({ className, orientation = "horizontal", ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex gap-2 data-horizontal:flex-col", className)}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

/**
 * For the `line` variant, render a single sliding underline that animates
 * between active tabs instead of cross-fading per-trigger ::after underlines.
 * Measures the active tab via offsetLeft/offsetWidth in a layout effect and
 * keeps it in sync with a ResizeObserver (window/font/locale changes) and a
 * MutationObserver on `data-active` (active tab change).
 */
function TabsList({
  className,
  variant = "default",
  children,
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  });

  useLayoutEffect(() => {
    if (variant !== "line") return;
    const node = wrapperRef.current;
    if (!node) return;

    const update = () => {
      const active = node.querySelector<HTMLElement>("[data-active]");
      if (active) {
        setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
      }
    };
    update();

    const ro = new ResizeObserver(update);
    ro.observe(node);
    const mo = new MutationObserver(update);
    mo.observe(node, {
      attributes: true,
      attributeFilter: ["data-active"],
      subtree: true,
    });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [variant]);

  const list = (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    >
      {children}
    </TabsPrimitive.List>
  );

  if (variant !== "line") return list;

  return (
    <div ref={wrapperRef} className="relative">
      {list}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-[-1px] h-0.5 rounded-full bg-foreground transition-[left,width] duration-300 ease-out"
        style={{ left: indicator.left, width: indicator.width }}
      />
    </div>
  );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // Line variant: no background, no border on active — the sliding
        // indicator owned by <TabsList> paints the active marker.
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        // Default variant: equal-width segmented pills + a card-like active
        // highlight. The `line` (underline) variant stays content-width so
        // each tab hugs its label and the sliding indicator matches it.
        "group-data-[variant=default]/tabs-list:flex-1 data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  );
}

const DEFAULT_HEIGHT_TRANSITION: Transition = {
  type: "spring",
  stiffness: 300,
  damping: 30,
  bounce: 0,
};

/**
 * Optional wrapper around a group of `TabsContent`s. Animates the container's
 * **height** to match the currently-visible panel, without touching the
 * children's layout.
 *
 * Why not Framer's `layout="size"`: that uses FLIP, which applies inverse
 * transforms to children during the parent's animation — the side-effect is
 * that the new panel's items appear to "drop in" / slide as the container
 * resizes. We just want the container to grow/shrink underneath stable
 * children, so we measure the active panel ourselves and animate `height`
 * directly with a spring.
 *
 * Usage:
 *   <Tabs value={…}>
 *     <TabsList variant="line">…</TabsList>
 *     <TabsContents>
 *       <TabsContent value="a">…</TabsContent>
 *       <TabsContent value="b">…</TabsContent>
 *     </TabsContents>
 *   </Tabs>
 */
function TabsContents({
  className,
  children,
  style,
  transition = DEFAULT_HEIGHT_TRANSITION,
  ...props
}: HTMLMotionProps<"div">) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      for (const child of Array.from(el.children)) {
        if (child instanceof HTMLElement && !child.hasAttribute("hidden")) {
          setHeight(child.getBoundingClientRect().height);
          return;
        }
      }
    };

    measure();

    // Observe every panel for its own content-size changes.
    const ro = new ResizeObserver(measure);
    const observeChildren = () => {
      ro.disconnect();
      for (const child of Array.from(el.children)) {
        if (child instanceof HTMLElement) ro.observe(child);
      }
    };
    observeChildren();

    // Re-attach + re-measure when BaseUI mounts/unmounts a panel or toggles
    // the `hidden` attribute on a keepMounted panel.
    const mo = new MutationObserver(() => {
      observeChildren();
      measure();
    });
    mo.observe(el, {
      childList: true,
      attributes: true,
      attributeFilter: ["hidden"],
      subtree: true,
    });

    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  return (
    <motion.div
      ref={containerRef}
      data-slot="tabs-contents"
      animate={{ height }}
      transition={transition}
      style={{ overflow: "hidden", ...style }}
      className={cn("relative", className)}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, TabsContents, tabsListVariants };
