import { cx } from "../landing/primitives";
import { HERO_SHOTS } from "./content";

export function SurfaceControls({
  activeIndex,
  cycleMs,
  reduced,
  rotationPaused,
  userPaused,
  onPausePointerDown,
  onRequestFrame,
  onToggleRotation,
}: {
  activeIndex: number;
  cycleMs: number;
  reduced: boolean;
  rotationPaused: boolean;
  userPaused: boolean;
  onPausePointerDown: () => void;
  onRequestFrame: (index: number) => void;
  onToggleRotation: (clickDetail: number) => void;
}) {
  return (
    <div className="rounded-b-xl border border-white/[0.1] bg-[#0c0d0e]">
      <div className="flex justify-end border-b border-white/[0.08] px-2.5 py-1.5">
        <button
          type="button"
          disabled={reduced}
          onPointerDown={onPausePointerDown}
          onClick={(event) => onToggleRotation(event.detail)}
          className="rounded-sm px-1.5 py-1 text-[0.7rem] font-medium text-white/55 outline-none hover:text-white/80 focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-default disabled:text-white/35"
        >
          {reduced
            ? "Rotation off · reduced motion"
            : userPaused
              ? "Resume automatic rotation"
              : "Pause automatic rotation"}
        </button>
      </div>
      <div
        role="group"
        aria-label="Choose control plane surface"
        className="grid grid-cols-2 gap-1 p-1.5 sm:grid-cols-4"
      >
        {HERO_SHOTS.map((shot, index) => (
          <button
            key={shot.key}
            type="button"
            aria-pressed={activeIndex === index}
            aria-controls="control-plane-surface"
            onClick={() => onRequestFrame(index)}
            className={cx(
              "group flex flex-col gap-2 rounded-md px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/40",
              activeIndex === index ? "bg-white/[0.05]" : "hover:bg-white/[0.025]",
            )}
          >
            <span
              className={cx(
                "text-[0.75rem] font-medium transition-colors duration-200",
                activeIndex === index ? "text-white/90" : "text-white/55 group-hover:text-white/70",
              )}
            >
              {shot.tab}
            </span>
            <span className="h-[3px] w-full overflow-hidden rounded-full bg-white/[0.08]">
              {activeIndex === index && (
                <span
                  key={activeIndex}
                  className="od-progress block h-full w-0 rounded-full bg-[#3d7bfb]"
                  style={{
                    animationDuration: `${cycleMs}ms`,
                    animationPlayState: rotationPaused ? "paused" : "running",
                  }}
                />
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
