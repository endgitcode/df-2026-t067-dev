/** All coordinates use the same viewport origin, including visualViewport offsets. */
export function mapControlsPlacement(shellBottom: number, sheetTop: number, controlsHeight: number, clearTop: number) {
  const bottom = Math.max(0, shellBottom - sheetTop + 12)
  return { bottom, hidden: sheetTop - 12 - controlsHeight < clearTop }
}
