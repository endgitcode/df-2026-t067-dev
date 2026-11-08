import type { PublicArea, PublicQuest } from '../../shared/api/types'

export interface ViewportBounds { north: number; south: number; east: number; west: number }

// ピンは問題の対象座標ではなく、公開探索エリアの代表点（外周リングの重心）に置く。
// MultiPolygon は最初に有効なポリゴンの外周を使う。
export function areaPinPosition(area: PublicArea): { lat: number; lng: number } | null {
  const geometry = area.publicGeometry
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  for (const polygon of polygons) {
    const ring = polygon?.[0]
    if (!ring || ring.length < 4) continue
    if (!ring.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90)) continue
    const [firstLng, firstLat] = ring[0]
    const [lastLng, lastLat] = ring[ring.length - 1]
    const points = firstLng === lastLng && firstLat === lastLat ? ring.slice(0, -1) : ring
    if (!points.length) continue
    let lat = 0
    let lng = 0
    for (const [pointLng, pointLat] of points) { lng += pointLng; lat += pointLat }
    return { lat: lat / points.length, lng: lng / points.length }
  }
  return null
}

export function pointInViewport(lat: number, lng: number, bounds: ViewportBounds): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  if (lat < bounds.south || lat > bounds.north) return false
  // 日付変更線をまたぐ表示範囲では西端が東端より大きくなる。
  if (bounds.west <= bounds.east) return lng >= bounds.west && lng <= bounds.east
  return lng >= bounds.west || lng <= bounds.east
}

// 表示範囲の判定は地域の代表点で行い、問題そのものの座標は使わない。
// bounds が null（範囲未確定）の間は全件を返す。
export function questsInViewport(areas: PublicArea[], quests: PublicQuest[], bounds: ViewportBounds | null): PublicQuest[] {
  const areaOrder = new Map(areas.map((area, index) => [area.areaId, index]))
  const visibleAreaIds = bounds === null ? null : new Set(areas.filter((area) => {
    const position = areaPinPosition(area)
    return position !== null && pointInViewport(position.lat, position.lng, bounds)
  }).map((area) => area.areaId))
  return quests
    .map((quest, index) => ({ quest, index }))
    .filter(({ quest }) => visibleAreaIds === null || visibleAreaIds.has(quest.areaId))
    .sort((a, b) => (areaOrder.get(a.quest.areaId) ?? Number.MAX_SAFE_INTEGER) - (areaOrder.get(b.quest.areaId) ?? Number.MAX_SAFE_INTEGER) || a.index - b.index)
    .map(({ quest }) => quest)
}

export function questThumbnail(quest: PublicQuest): string | undefined {
  if (quest.optionalHintImage) return quest.optionalHintImage
  return quest.hintImages?.find((image) => typeof image === 'string' && image.length > 0) ?? undefined
}
