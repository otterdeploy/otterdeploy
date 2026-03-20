import * as motion from "motion/react-client"
import type { Environment } from "../types"

export function EnvironmentCard({
  environment,
  offset,
  onClick,
}: {
  environment: Environment
  offset: number // 0 = center, negative = left, positive = right
  onClick: () => void
}) {
  const isActive = offset === 0
  const absOffset = Math.abs(offset)

  return (
    <motion.div
      className="absolute cursor-pointer rounded-xl border border-border bg-card p-6 w-[280px]"
      animate={{
        x: offset * 300,
        scale: isActive ? 1 : Math.max(0.85 - absOffset * 0.05, 0.7),
        opacity: isActive ? 1 : Math.max(0.5 - absOffset * 0.15, 0.1),
        zIndex: 10 - absOffset,
      }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      onClick={onClick}
    >
      <h3 className="text-lg font-medium text-foreground">{environment.label}</h3>
      <p className="text-sm text-muted-foreground mt-1">{environment.name}</p>
    </motion.div>
  )
}
