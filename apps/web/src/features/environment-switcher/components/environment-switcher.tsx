import * as motion from "motion/react-client"
import { AnimatePresence } from "motion/react"
import type { Environment } from "../types"
import { EnvironmentCard } from "./environment-card"

export function EnvironmentSwitcher({
  environments,
  activeIndex,
  isOpen,
  onClose,
  onSelect,
  onSetIndex,
}: {
  environments: Environment[]
  activeIndex: number
  isOpen: boolean
  onClose: () => void
  onSelect: (index: number) => void
  onSetIndex: (index: number) => void
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          {/* Carousel */}
          <div
            className="relative flex items-center justify-center h-48"
            onClick={(e) => e.stopPropagation()}
          >
            {environments.map((env, index) => (
              <EnvironmentCard
                key={env.id}
                environment={env}
                offset={index - activeIndex}
                onClick={() => onSelect(index)}
              />
            ))}
          </div>

          {/* Dots */}
          <div
            className="absolute bottom-12 left-1/2 -translate-x-1/2 flex gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {environments.map((env, index) => (
              <button
                key={env.id}
                type="button"
                className={`size-2 rounded-full transition-colors ${
                  index === activeIndex
                    ? "bg-foreground"
                    : "bg-muted-foreground/40"
                }`}
                onClick={() => onSetIndex(index)}
              />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
