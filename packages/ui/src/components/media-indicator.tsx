import { cn } from "../lib/utils";
/**
 *
 * It is used to display the media query indicator in the bottom left corner of the screen.
 * using Tailwind CSS to display the media query indicator.
 * @returns
 */
export function MediaQueryIndicator({
  position = "bottom-right",
}: {
  position?: "bottom-left" | "bottom-right" | "top-left" | "top-right";
}) {
  return (
    <div
      className={cn(
        "fixed bottom-1 left-1 z-50 flex size-6 size-10 items-center justify-center rounded-full bg-gray-800 p-3 font-mono text-white text-xs",
        position === "bottom-left"
          ? "left-1"
          : position === "bottom-right"
            ? "right-1"
            : position === "top-left"
              ? "left-1 top-1"
              : "right-1 top-1",
      )}
    >
      <div className="block sm:hidden">xs</div>
      <div className="hidden sm:block md:hidden lg:hidden xl:hidden 2xl:hidden">sm</div>
      <div className="hidden md:block lg:hidden xl:hidden 2xl:hidden">md</div>
      <div className="hidden lg:block xl:hidden 2xl:hidden">lg</div>
      <div className="hidden xl:block 2xl:hidden">xl</div>
      <div className="hidden 2xl:block">2xl</div>
    </div>
  );
}
