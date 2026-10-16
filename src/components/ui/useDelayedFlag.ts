import { useEffect, useState } from 'react'

/** Orçamento de latência: esqueleto/spinner só depois de 400 ms. Devolve true quando `active` durou mais que `delay`. */
export const SKELETON_DELAY_MS = 400
export function useDelayedFlag(active: boolean, delay = SKELETON_DELAY_MS): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!active) { setOn(false); return }
    const timer = setTimeout(() => setOn(true), delay)
    return () => clearTimeout(timer)
  }, [active, delay])
  return active && on
}
