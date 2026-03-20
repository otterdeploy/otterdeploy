import { useCallback, useState } from "react"
import type { Environment } from "../types"

export function useEnvironmentSwitcher(environments: Environment[]) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const open = useCallback(
    (currentEnvName: string) => {
      const index = environments.findIndex((e) => e.name === currentEnvName)
      setActiveIndex(index >= 0 ? index : 0)
      setIsOpen(true)
    },
    [environments],
  )

  const close = useCallback(() => {
    setIsOpen(false)
  }, [])

  const next = useCallback(() => {
    setActiveIndex((i) => Math.min(i + 1, environments.length - 1))
  }, [environments.length])

  const prev = useCallback(() => {
    setActiveIndex((i) => Math.max(i - 1, 0))
  }, [])

  const select = useCallback(() => {
    setIsOpen(false)
    return environments[activeIndex]
  }, [environments, activeIndex])

  return { isOpen, activeIndex, setActiveIndex, open, close, next, prev, select }
}
