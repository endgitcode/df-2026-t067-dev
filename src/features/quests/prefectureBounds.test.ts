import { describe, expect, it } from 'vitest'
import { REGIONS } from './areaHierarchy'
import { boundsForFilter, PREFECTURE_BOUNDS } from './prefectureBounds'

describe('static filter bounds', () => {
  it('covers all 47 prefectures with valid bounds', () => {
    expect(Object.keys(PREFECTURE_BOUNDS)).toHaveLength(47)
    for (const region of REGIONS) for (const name of region.prefectures) {
      const b = PREFECTURE_BOUNDS[name]
      expect(b.south).toBeLessThan(b.north)
      expect(b.west).toBeLessThan(b.east)
    }
  })
  it('unions every prefecture in a region, independently of catalog pins', () => {
    const bounds = boundsForFilter('東北', '')!
    for (const name of REGIONS[1].prefectures) {
      const b = PREFECTURE_BOUNDS[name]
      expect(bounds.south).toBeLessThanOrEqual(b.south)
      expect(bounds.north).toBeGreaterThanOrEqual(b.north)
      expect(bounds.west).toBeLessThanOrEqual(b.west)
      expect(bounds.east).toBeGreaterThanOrEqual(b.east)
    }
    expect(boundsForFilter('北海道', '北海道')).toEqual(PREFECTURE_BOUNDS['北海道'])
    expect(boundsForFilter('', '')).toBeUndefined()
  })
})

  it('merges bounds for multiple regions and prefectures', () => {
    const bounds = boundsForFilter(['関東', '北海道'], ['大阪府'])!
    const kanto = boundsForFilter('関東', '')!
    const hokkaido = PREFECTURE_BOUNDS['北海道']
    const osaka = PREFECTURE_BOUNDS['大阪府']
    expect(bounds.south).toBe(Math.min(kanto.south, hokkaido.south, osaka.south))
    expect(bounds.north).toBe(Math.max(kanto.north, hokkaido.north, osaka.north))
    expect(bounds.west).toBe(Math.min(kanto.west, hokkaido.west, osaka.west))
    expect(bounds.east).toBe(Math.max(kanto.east, hokkaido.east, osaka.east))
  })
