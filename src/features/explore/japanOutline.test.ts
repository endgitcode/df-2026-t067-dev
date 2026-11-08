import { describe, expect, it } from 'vitest'
import { JAPAN_OUTLINE_RINGS } from './japanOutline'

function insideRing(lng: number, lat: number, ring: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    if ((y1 > lat) !== (y2 > lat)) {
      const crossLng = x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1)
      if (lng < crossLng) inside = !inside
    }
  }
  return inside
}

describe('Japan outline data (D-41)', () => {
  it('consists of closed rings with finite coordinates around Japan', () => {
    expect(JAPAN_OUTLINE_RINGS.length).toBeGreaterThanOrEqual(5)
    for (const ring of JAPAN_OUTLINE_RINGS) {
      expect(ring.length).toBeGreaterThanOrEqual(4)
      expect(ring[0]).toEqual(ring[ring.length - 1])
      for (const [lng, lat] of ring) {
        expect(Number.isFinite(lng)).toBe(true)
        expect(Number.isFinite(lat)).toBe(true)
        expect(lng).toBeGreaterThan(120)
        expect(lng).toBeLessThan(150)
        expect(lat).toBeGreaterThan(20)
        expect(lat).toBeLessThan(50)
      }
    }
  })

  it('keeps every demo area center (and Koriyama) inside the bright cutout', () => {
    // [経度, 緯度]：10のデモ地域の代表点（郡山を含む）。
    const centers: Array<readonly [number, number]> = [
      [141.3544, 43.0621], [140.8694, 38.2682], [140.3599, 37.4003], [139.7671, 35.6812], [139.638, 35.4437],
      [135.7681, 35.0116], [135.5023, 34.6937], [132.4553, 34.3853], [130.4017, 33.5904], [127.6809, 26.2124],
    ]
    for (const [lng, lat] of centers) {
      expect(JAPAN_OUTLINE_RINGS.some((ring) => insideRing(lng, lat, ring))).toBe(true)
    }
  })
})
