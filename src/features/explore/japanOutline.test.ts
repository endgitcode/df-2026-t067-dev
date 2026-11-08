import { describe, expect, it } from 'vitest'
import { JAPAN_OUTLINE_RINGS, JAPAN_VEIL_OUTER_RING, buildJapanVeilPaths } from './japanOutline'

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

  it('winds the outer ring opposite to every Japan hole ring', () => {
    // Google Maps の Polygon が穴として扱う条件：外周と穴の巻き方向が逆向きであること。
    const outerSign = Math.sign(signedArea(JAPAN_VEIL_OUTER_RING))
    expect(outerSign).not.toBe(0)
    for (const ring of JAPAN_OUTLINE_RINGS) {
      expect(Math.sign(signedArea(ring))).toBe(-outerSign)
    }
  })

  it('contains every Japan outline point strictly inside the outer ring', () => {
    for (const ring of JAPAN_OUTLINE_RINGS) {
      for (const [lng, lat] of ring) {
        expect(insideRing(lng, lat, JAPAN_VEIL_OUTER_RING)).toBe(true)
      }
    }
  })

  it('covers outside-Japan points but leaves Japan itself bright (hole semantics)', () => {
    // ベールがかかる判定の模擬：外周の内側にあり、どの日本の輪郭（穴）にも入っていない点だけが覆われる。
    const covered = (lng: number, lat: number) =>
      insideRing(lng, lat, JAPAN_VEIL_OUTER_RING) && !JAPAN_OUTLINE_RINGS.some((ring) => insideRing(lng, lat, ring))
    // 日本の内側は覆われない（東京・札幌・那覇）。
    expect(covered(139.7671, 35.6812)).toBe(false)
    expect(covered(141.3544, 43.0621)).toBe(false)
    expect(covered(127.6809, 26.2124)).toBe(false)
    // 日本の外は覆われる（ソウル・北京・台湾・太平洋）。
    expect(covered(126.978, 37.567)).toBe(true)
    expect(covered(116.407, 39.904)).toBe(true)
    expect(covered(121.0, 23.8)).toBe(true)
    expect(covered(160, 35)).toBe(true)
  })

  it('builds veil paths with the outer ring first and all coordinates converted to {lat, lng}', () => {
    const paths = buildJapanVeilPaths()
    expect(paths).toHaveLength(JAPAN_OUTLINE_RINGS.length + 1)
    expect(paths[0]).toEqual(JAPAN_VEIL_OUTER_RING.map(([lng, lat]) => ({ lat, lng })))
    expect(paths[1][0]).toEqual({ lat: JAPAN_OUTLINE_RINGS[0][0][1], lng: JAPAN_OUTLINE_RINGS[0][0][0] })
    for (const path of paths) {
      for (const point of path) {
        expect(Math.abs(point.lng)).toBeLessThan(180)
      }
    }
  })
})
