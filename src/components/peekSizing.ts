/** Leave room for the database while keeping the preview usable on smaller windows. */
export function clampPeekWidth(width: number, viewportWidth: number, sidebarWidth = 0): number {
  const available = Math.max(0, viewportWidth - sidebarWidth)
  const maximum = Math.max(0, available - Math.min(320, available * .28))
  const minimum = Math.min(380, maximum)
  return Math.round(Math.max(minimum, Math.min(maximum, width)))
}
