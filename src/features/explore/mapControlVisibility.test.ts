import { describe, expect, it } from 'vitest'
import { isMapControlCovered, isMapControlWithin, type ControlRect } from './mapControlVisibility'

const rect = (left: number, top: number, right: number, bottom: number): ControlRect => ({
  left, top, right, bottom, width: right - left, height: bottom - top,
})

describe('map control sheet visibility', () => {
  const sheet = rect(0, 400, 360, 700)

  it('marks even a one pixel vertical overlap unsafe', () => {
    expect(isMapControlCovered(rect(300, 350, 344, 401), sheet)).toBe(true)
  })

  it('does not cover a button that is horizontally outside the sheet', () => {
    expect(isMapControlCovered(rect(370, 350, 414, 444), sheet)).toBe(false)
  })

  it('does not cover a button that only touches the sheet edge', () => {
    expect(isMapControlCovered(rect(300, 350, 344, 400), sheet)).toBe(false)
  })

  it('requires the whole button to remain inside the visible map shell', () => {
    const visibleShell = rect(0, 100, 360, 700)
    expect(isMapControlWithin(rect(300, 650, 344, 694), visibleShell)).toBe(true)
    expect(isMapControlWithin(rect(300, 650, 344, 701), visibleShell)).toBe(false)
    expect(isMapControlWithin(rect(340, 150, 384, 194), visibleShell)).toBe(false)
  })
})
