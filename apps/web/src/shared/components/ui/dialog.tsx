import * as React from "react";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/utils";

import { Button } from "../ui/button";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-[50ms] supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          // grid-cols-[minmax(0,1fr)], not grid-cols-1: a bare `1fr` track
          // takes its automatic minimum from content, so wide children (a long
          // title, a code block, a table) stretch the dialog past max-w-sm.
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 grid-cols-[minmax(0,1fr)] gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-[50ms] outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          // A tall form (Add server runs ~1200px) in a centred dialog with no
          // height cap hangs off BOTH ends of a phone screen. Half the fields
          // above the top edge, the submit buttons below the bottom, and no way
          // to reach either, because the page behind is what scrolls. Cap the
          // popup to the viewport and let its own content scroll.
          // `svh`, not `vh`: mobile browser chrome makes `vh` taller than what
          // is actually on screen, which would re-hide the footer it exists to
          // protect. overscroll-contain keeps the page behind from scrolling
          // once the dialog hits its end.
          "max-h-[calc(100svh-2rem)] overflow-y-auto overscroll-contain",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          // Sticky, not absolute: the popup is now the scroll container, and an
          // absolutely-positioned close sits at the top of the CONTENT. It
          // scrolls out of sight the moment a tall dialog is scrolled. Parked
          // in the first grid cell at zero height so it overlays the header
          // instead of taking a row of its own, and pinned there while the rest
          // scrolls under it.
          <div className="pointer-events-none sticky top-0 z-10 col-start-1 row-start-1 h-0 justify-self-end">
            <DialogPrimitive.Close
              data-slot="dialog-close"
              render={
                <Button
                  variant="ghost"
                  className="pointer-events-auto -mt-2 -mr-2"
                  size="icon-sm"
                />
              }
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
              <span className="sr-only">{t("common.close")}</span>
            </DialogPrimitive.Close>
          </div>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="dialog-header" className={cn("flex flex-col gap-2", className)} {...props} />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          {t("common.close")}
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      // See AlertDialogTitle: an interpolated identifier with no break
      // opportunity would otherwise set the grid track's minimum width and
      // push the dialog past its max-width. `leading-none` is dropped to
      // `leading-tight` so a title that now wraps doesn't collide with itself.
      className={cn(
        "min-w-0 font-heading text-base leading-tight font-medium [overflow-wrap:anywhere]",
        className,
      )}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "min-w-0 text-sm [overflow-wrap:anywhere] text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
