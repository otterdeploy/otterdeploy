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
  const scale = isActive ? 1 : Math.max(0.85 - absOffset * 0.05, 0.7)
  const opacity = isActive ? 1 : Math.max(0.5 - absOffset * 0.15, 0.1)
  const x = offset * 300

  return (
    <motion.div
      className="absolute cursor-pointer rounded-xl border border-border bg-card p-6 w-[280px]"
      style={{ zIndex: 10 - absOffset }}
      initial={false}
      animate={{ x, scale, opacity }}
      transition={{ type: "spring", stiffness: 400, damping: 40 }}
      onClick={onClick}
    >
      <h3 className="text-lg font-medium text-foreground">{environment.label}</h3>
      <p className="text-sm text-muted-foreground mt-1">{environment.name}</p>
    </motion.div>
  )
}
