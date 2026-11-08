import { describe, expect, it } from 'vitest'
import type { PublicArea } from '../../shared/api/types'
import { getRegionAreas, prefectureForArea, regionForPrefecture } from './areaHierarchy'

const area = (areaId: string, label: string, prefectureCode?: string): PublicArea & { prefectureCode?: string } => ({ areaId, label, prefectureCode,
  publicGeometry: { type: 'Polygon', coordinates: [] }, marker: { latitude: 0, longitude: 0 }, publishedCount: 1 })

describe('exploration area hierarchy', () => {
  it('uses the code even when the name suggests a different prefecture', () => {
    expect(prefectureForArea(area('a', '神奈川県の探索地域', '13'))).toBe('東京都')
    expect(prefectureForArea(area('b', '東京都千代田区'))).toBeUndefined()
    expect(prefectureForArea(area('c', '東京都', '48'))).toBeUndefined()
    expect(prefectureForArea(area('d', '島の探索地域', '47'))).toBe('沖縄県')
    expect(regionForPrefecture('東京都')).toBe('関東')
  })

  it('keeps unclassified areas accessible and filters classified areas by prefecture', () => {
    const areas = [area('tokyo', '川辺エリア', '13'), area('osaka', '森エリア', '27'), area('unknown', '川辺エリア')]
    expect(getRegionAreas(areas, '', '')).toEqual(areas)
    expect(getRegionAreas(areas, '関東', '東京都').map((item) => item.areaId)).toEqual(['tokyo'])
    expect(getRegionAreas(areas, '未分類', '').map((item) => item.areaId)).toEqual(['unknown'])
  })
})

