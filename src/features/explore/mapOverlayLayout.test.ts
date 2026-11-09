import { describe, expect, it } from 'vitest'
import { mapControlsPlacement } from './mapOverlayLayout'
import { visibleAreaFitPadding } from './fitPadding'

describe('mobile map overlay clearance', () => {
  it('keeps controls above peek and half sheets', () => {
    for (const sheetTop of [612, 351]) {
      const result = mapControlsPlacement(844, sheetTop, 194, 110)
      expect(844 - result.bottom).toBe(sheetTop - 12)
      expect(result.hidden).toBe(false)
    }
  })
  it('hides controls when the full sheet leaves insufficient space', () => {
    expect(mapControlsPlacement(844, 84, 194, 110).hidden).toBe(true)
  })
  it('uses the actual sheet edge with a safe area and horizontal controls', () => {
    const result = mapControlsPlacement(430, 250, 48, 100)
    expect(result).toEqual({ bottom: 192, hidden: false })
    expect(mapControlsPlacement(430, 160, 48, 100).hidden).toBe(false)
    expect(mapControlsPlacement(430, 159, 48, 100).hidden).toBe(true)
  })
  it('preserves bottom clearance for the sheet and navigation', () => {
    expect(visibleAreaFitPadding(false).bottom).toBe(252)
    expect(visibleAreaFitPadding(false, false, 429).bottom).toBe(513)
    expect(visibleAreaFitPadding(false, false, 168, 0).top).toBe(140)
  })
  it('accounts for a taller header and marker height in mobile fits', () => {
    expect(visibleAreaFitPadding(false, false, 168, 120).top).toBeGreaterThanOrEqual(180)
    expect(visibleAreaFitPadding(true, false, 168, 120).top).toBe(88)
  })
})
