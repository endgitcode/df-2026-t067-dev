import { describe, expect, it } from 'vitest'
import {
  isPrefectureEffectivelySelected,
  regionRowSummary,
  regionWholeLabel,
  withPrefectureToggle,
  withRegionWhole,
} from './placeFilterSelection'

describe('placeFilterSelection', () => {
  it('labels whole-region control', () => {
    expect(regionWholeLabel('関東')).toBe('関東地方ぜんぶ')
    expect(regionWholeLabel('北海道')).toBe('北海道ぜんぶ')
    expect(regionWholeLabel('九州・沖縄')).toBe('九州・沖縄ぜんぶ')
  })

  it('selecting whole region clears redundant prefs in that region', () => {
    const next = withRegionWhole([], ['東京都', '大阪府'], '関東', true)
    expect(next.regions).toEqual(['関東'])
    expect(next.prefectures).toEqual(['大阪府'])
  })

  it('unchecking one pref while whole expands to the remaining prefs', () => {
    const next = withPrefectureToggle(['関東'], [], '関東', '東京都')
    expect(next.regions).toEqual([])
    expect(next.prefectures).toContain('神奈川県')
    expect(next.prefectures).not.toContain('東京都')
    expect(next.prefectures).toHaveLength(6)
  })

  it('selecting every pref promotes to whole region', () => {
    let regions: string[] = []
    let prefs: string[] = []
    for (const name of ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県']) {
      ;({ regions, prefectures: prefs } = withPrefectureToggle(regions, prefs, '関東', name))
    }
    expect(regions).toEqual(['関東'])
    expect(prefs).toEqual([])
  })

  it('row summary shows N県 for partial selection', () => {
    expect(regionRowSummary('関東', [], ['東京都', '神奈川県'])).toEqual({ whole: false, count: 2, label: '2県' })
    expect(regionRowSummary('関東', ['関東'], []).label).toBe('')
    expect(isPrefectureEffectivelySelected('関東', '東京都', ['関東'], [])).toBe(true)
    expect(isPrefectureEffectivelySelected('関東', '東京都', [], ['神奈川県'])).toBe(false)
  })
})
