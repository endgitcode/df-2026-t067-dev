import { describe, expect, it } from 'vitest'
import {
  JAPAN_VEIL_OUTER_RING,
  JAPAN_VEIL_SPOTLIGHT_CENTER,
  JAPAN_VEIL_SPOTLIGHT_RADIUS_KM,
  JAPAN_VEIL_SPOTLIGHT_RING,
  buildJapanVeilPaths,
} from './japanVeil'

function signedArea(ring: ReadonlyArray<readonly [number, number]>): number {
  let area = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    area += x1 * y2 - x2 * y1
  }
  return area / 2
}

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

const EARTH_RADIUS_KM = 6371

function distanceKm(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const phi1 = (lat1 * Math.PI) / 180
  const phi2 = (lat2 * Math.PI) / 180
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180
  const deltaLambda = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a))
}

function distanceFromSpotlightCenterKm(lng: number, lat: number): number {
  return distanceKm(JAPAN_VEIL_SPOTLIGHT_CENTER.lng, JAPAN_VEIL_SPOTLIGHT_CENTER.lat, lng, lat)
}

// [経度, 緯度]：10のデモ地域の代表点（郡山を含む）。
const DEMO_AREA_CENTERS: Array<readonly [number, number]> = [
  [141.3544, 43.0621], [140.8694, 38.2682], [140.3599, 37.4003], [139.7671, 35.6812], [139.638, 35.4437],
  [135.7681, 35.0116], [135.5023, 34.6937], [132.4553, 34.3853], [130.4017, 33.5904], [127.6809, 26.2124],
]

describe('Japan veil spotlight (D-41)', () => {
  it('is a closed ring whose points all sit on the spherical circle around the center', () => {
    expect(JAPAN_VEIL_SPOTLIGHT_RING.length).toBeGreaterThanOrEqual(33)
    expect(JAPAN_VEIL_SPOTLIGHT_RING[0]).toEqual(JAPAN_VEIL_SPOTLIGHT_RING[JAPAN_VEIL_SPOTLIGHT_RING.length - 1])
    for (const [lng, lat] of JAPAN_VEIL_SPOTLIGHT_RING) {
      expect(Number.isFinite(lng)).toBe(true)
      expect(Number.isFinite(lat)).toBe(true)
      // 球面の円として生成しているため、全点が中心から半径どおりの距離にある（緯度による経度の歪みを含む）。
      expect(Math.abs(distanceFromSpotlightCenterKm(lng, lat) - JAPAN_VEIL_SPOTLIGHT_RADIUS_KM)).toBeLessThan(1)
    }
  })

  it('is centered on the spherical midpoint of the Naha–Sapporo diagonal with at least 100km of margin', () => {
    // 対角の両端（那覇・札幌）から中心までの距離がほぼ等しく、半径には 100km 以上の余白があること。
    const nahaKm = distanceFromSpotlightCenterKm(127.6809, 26.2124)
    const sapporoKm = distanceFromSpotlightCenterKm(141.3544, 43.0621)
    expect(Math.abs(nahaKm - sapporoKm)).toBeLessThan(1)
    expect(JAPAN_VEIL_SPOTLIGHT_RADIUS_KM - nahaKm).toBeGreaterThanOrEqual(100)
    expect(JAPAN_VEIL_SPOTLIGHT_RADIUS_KM - sapporoKm).toBeGreaterThanOrEqual(100)
  })

  it('keeps every demo area center (and Koriyama) inside the bright spotlight', () => {
    for (const [lng, lat] of DEMO_AREA_CENTERS) {
      expect(distanceFromSpotlightCenterKm(lng, lat)).toBeLessThan(JAPAN_VEIL_SPOTLIGHT_RADIUS_KM)
      // 描画側の穴判定（平面の内外判定）でも内側に入ること。
      expect(insideRing(lng, lat, JAPAN_VEIL_SPOTLIGHT_RING)).toBe(true)
    }
  })

  it('stays strictly inside the veil outer ring', () => {
    for (const [lng, lat] of JAPAN_VEIL_SPOTLIGHT_RING) {
      expect(insideRing(lng, lat, JAPAN_VEIL_OUTER_RING)).toBe(true)
    }
  })
})

describe('Japan veil structure (D-41)', () => {
  it('uses a bounded outer ring that never touches the antimeridian', () => {
    // 世界全体（経度±180・緯度±85）の矩形を外周にすると、球面上では角が経度±180で一致して潰れ、
    // 内側の判定が反転して日本だけが塗られる（2026-11-08 の実機不具合）。外周は必ず ±180 に触れないこと。
    expect(JAPAN_VEIL_OUTER_RING.length).toBeGreaterThanOrEqual(4)
    expect(JAPAN_VEIL_OUTER_RING[0]).toEqual(JAPAN_VEIL_OUTER_RING[JAPAN_VEIL_OUTER_RING.length - 1])
    for (const [lng, lat] of JAPAN_VEIL_OUTER_RING) {
      expect(Math.abs(lng)).toBeLessThan(180)
      expect(Math.abs(lat)).toBeLessThan(90)
    }
    // 球面の半分を大きく下回る大きさに収まっていること（平面近似の面積比でも余裕を見る）。
    expect(Math.abs(signedArea(JAPAN_VEIL_OUTER_RING)) / (360 * 180)).toBeLessThan(0.25)
  })

  it('winds the outer ring opposite to the spotlight hole ring', () => {
    // Google Maps の Polygon が穴として扱う条件：外周と穴の巻き方向が逆向きであること。
    const outerSign = Math.sign(signedArea(JAPAN_VEIL_OUTER_RING))
    expect(outerSign).not.toBe(0)
    expect(Math.sign(signedArea(JAPAN_VEIL_SPOTLIGHT_RING))).toBe(-outerSign)
  })

  it('covers far outside-Japan points but leaves Japan itself bright (hole semantics)', () => {
    // ベールがかかる判定の模擬：外周の内側にあり、スポットライトの円（穴）の外側にある点だけが覆われる。
    const covered = (lng: number, lat: number) =>
      insideRing(lng, lat, JAPAN_VEIL_OUTER_RING) && !insideRing(lng, lat, JAPAN_VEIL_SPOTLIGHT_RING)
    // 円の内側は覆われない（東京・札幌・那覇）。
    expect(covered(139.7671, 35.6812)).toBe(false)
    expect(covered(141.3544, 43.0621)).toBe(false)
    expect(covered(127.6809, 26.2124)).toBe(false)
    // 円の外の遠方は覆われる（北京・台湾・太平洋）。
    expect(covered(116.407, 39.904)).toBe(true)
    expect(covered(121.0, 23.8)).toBe(true)
    expect(covered(160, 35)).toBe(true)
  })

  it('builds veil paths with the outer ring first and the spotlight circle as the only hole', () => {
    const paths = buildJapanVeilPaths()
    expect(paths).toHaveLength(2)
    expect(paths[0]).toEqual(JAPAN_VEIL_OUTER_RING.map(([lng, lat]) => ({ lat, lng })))
    expect(paths[1]).toEqual(JAPAN_VEIL_SPOTLIGHT_RING.map(([lng, lat]) => ({ lat, lng })))
    for (const path of paths) {
      for (const point of path) {
        expect(Math.abs(point.lng)).toBeLessThan(180)
      }
    }
  })
})
