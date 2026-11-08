import { describe, expect, it } from 'vitest'
import { areaPinPosition, pointInViewport, questThumbnail, questsInViewport, type ViewportBounds } from './viewportQuests'
import type { PublicArea, PublicQuest } from '../../shared/api/types'

const areaA: PublicArea = { areaId: 'area-a', label: 'A', publishedCount: 2, marker: { latitude: 35, longitude: 139 },
  publicGeometry: { type: 'Polygon', coordinates: [[[139, 35], [140, 35], [140, 36], [139, 36], [139, 35]]] } }
const areaB: PublicArea = { areaId: 'area-b', label: 'B', publishedCount: 1, marker: { latitude: 31, longitude: 130 },
  publicGeometry: { type: 'Polygon', coordinates: [[[130, 31], [131, 31], [131, 32], [130, 32], [130, 31]]] } }
const quest = (questId: string, areaId: string): PublicQuest => ({ questId, version: 1, title: questId, clue: 'clue', areaId, visitConditions: '', hintCount: 1 })
const quests = [quest('q-b1', 'area-b'), quest('q-a1', 'area-a'), quest('q-a2', 'area-a')]

describe('areaPinPosition', () => {
  it('uses the outer ring centroid, not a quest location', () => {
    expect(areaPinPosition(areaA)).toEqual({ lat: 35.5, lng: 139.5 })
    expect(areaPinPosition(areaB)).toEqual({ lat: 31.5, lng: 130.5 })
  })
})

const areaMulti: PublicArea = { areaId: 'area-multi', label: 'M', publishedCount: 1, marker: { latitude: 35.68, longitude: 139.72 },
  publicGeometry: { type: 'MultiPolygon', coordinates: [
    [[[139.70, 35.65], [139.74, 35.65], [139.74, 35.70], [139.70, 35.70], [139.70, 35.65]]],
    [[[139.56, 35.53], [139.60, 35.53], [139.60, 35.58], [139.56, 35.58], [139.56, 35.53]]],
    [[[139.88, 35.78], [139.92, 35.78], [139.92, 35.82], [139.88, 35.82], [139.88, 35.78]]],
  ] } }

describe('MultiPolygon areas (like the Tokyo demo area)', () => {
  it('places the pin at the first polygon centroid, which lies inside the overall bounds', () => {
    const position = areaPinPosition(areaMulti)
    expect(position).toEqual({ lat: 35.675, lng: 139.72 })
    const extent: ViewportBounds = { north: 35.82, south: 35.53, east: 139.92, west: 139.56 }
    expect(pointInViewport(position!.lat, position!.lng, extent)).toBe(true)
  })
  it('keeps the area quest listed when the viewport is the full MultiPolygon extent', () => {
    const extent: ViewportBounds = { north: 35.82, south: 35.53, east: 139.92, west: 139.56 }
    expect(questsInViewport([areaMulti], [quest('q-m1', 'area-multi')], extent).map((item) => item.questId)).toEqual(['q-m1'])
  })
})

describe('pointInViewport', () => {
  const bounds: ViewportBounds = { north: 36, south: 35, east: 140, west: 139 }
  it('accepts points inside and rejects points outside', () => {
    expect(pointInViewport(35.5, 139.5, bounds)).toBe(true)
    expect(pointInViewport(36.5, 139.5, bounds)).toBe(false)
    expect(pointInViewport(35.5, 138.5, bounds)).toBe(false)
  })
  it('handles a viewport crossing the antimeridian', () => {
    const crossing: ViewportBounds = { north: 40, south: 30, east: -170, west: 170 }
    expect(pointInViewport(35, 175, crossing)).toBe(true)
    expect(pointInViewport(35, -175, crossing)).toBe(true)
    expect(pointInViewport(35, 0, crossing)).toBe(false)
  })
})

describe('questsInViewport', () => {
  it('returns every quest in area order while bounds are unknown', () => {
    expect(questsInViewport([areaA, areaB], quests, null).map((item) => item.questId)).toEqual(['q-a1', 'q-a2', 'q-b1'])
  })
  it('keeps only quests whose area representative point is inside the bounds', () => {
    const aroundA: ViewportBounds = { north: 36, south: 35, east: 140, west: 139 }
    expect(questsInViewport([areaA, areaB], quests, aroundA).map((item) => item.questId)).toEqual(['q-a1', 'q-a2'])
    const aroundB: ViewportBounds = { north: 32, south: 31, east: 131, west: 130 }
    expect(questsInViewport([areaA, areaB], quests, aroundB).map((item) => item.questId)).toEqual(['q-b1'])
  })
  it('returns an empty list when no area is inside the bounds', () => {
    const nowhere: ViewportBounds = { north: 10, south: 0, east: 10, west: 0 }
    expect(questsInViewport([areaA, areaB], quests, nowhere)).toEqual([])
  })
})

describe('questThumbnail', () => {
  it('prefers the optional hint image, then the first non-empty hint image', () => {
    expect(questThumbnail({ ...quest('q1', 'area-a'), optionalHintImage: 'https://example.test/a.jpg', hintImages: ['https://example.test/b.jpg'] }))
      .toBe('https://example.test/a.jpg')
    expect(questThumbnail({ ...quest('q1', 'area-a'), hintImages: [null, 'https://example.test/c.jpg'] })).toBe('https://example.test/c.jpg')
    expect(questThumbnail(quest('q1', 'area-a'))).toBeUndefined()
  })
})
