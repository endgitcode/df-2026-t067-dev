import { REGIONS } from './areaHierarchy'

export function prefecturesOf(regionName: string): readonly string[] {
  return REGIONS.find((item) => item.name === regionName)?.prefectures ?? []
}

export function regionWholeLabel(regionName: string): string {
  if (regionName === '北海道') return '北海道ぜんぶ'
  if (regionName === '九州・沖縄') return '九州・沖縄ぜんぶ'
  return `${regionName}地方ぜんぶ`
}

/** 地方を丸ごと ON/OFF。ON ならその地方の個別県指定は外す（冗長のため）。 */
export function withRegionWhole(
  regions: readonly string[],
  prefectures: readonly string[],
  regionName: string,
  on: boolean,
): { regions: string[]; prefectures: string[] } {
  const prefs = prefecturesOf(regionName)
  const nextRegions = on
    ? (regions.includes(regionName) ? [...regions] : [...regions, regionName])
    : regions.filter((item) => item !== regionName)
  const nextPrefs = prefectures.filter((item) => !(prefs as readonly string[]).includes(item))
  return { regions: nextRegions, prefectures: nextPrefs }
}

/** 県チェックのトグル。全県そろえば地方丸ごと、地方丸ごと中の1県解除は残り県へ展開。 */
export function withPrefectureToggle(
  regions: readonly string[],
  prefectures: readonly string[],
  regionName: string,
  prefecture: string,
): { regions: string[]; prefectures: string[] } {
  const prefs = [...prefecturesOf(regionName)]
  if (!prefs.includes(prefecture)) {
    return { regions: [...regions], prefectures: [...prefectures] }
  }
  const regionOn = regions.includes(regionName)
  const selected = new Set(regionOn ? prefs : prefectures.filter((item) => prefs.includes(item)))
  if (selected.has(prefecture)) selected.delete(prefecture)
  else selected.add(prefecture)

  const nextRegions = regions.filter((item) => item !== regionName)
  const nextPrefs = prefectures.filter((item) => !prefs.includes(item))
  if (selected.size === prefs.length && prefs.length > 0) {
    return { regions: [...nextRegions, regionName], prefectures: nextPrefs }
  }
  return { regions: nextRegions, prefectures: [...nextPrefs, ...prefs.filter((item) => selected.has(item))] }
}

export function regionRowSummary(
  regionName: string,
  regions: readonly string[],
  prefectures: readonly string[],
): { whole: boolean; count: number; label: string } {
  const prefs = prefecturesOf(regionName)
  if (regions.includes(regionName)) return { whole: true, count: prefs.length, label: '' }
  const count = prefectures.filter((item) => (prefs as readonly string[]).includes(item)).length
  return { whole: false, count, label: count > 0 ? `${count}県` : '' }
}

export function isPrefectureEffectivelySelected(
  regionName: string,
  prefecture: string,
  regions: readonly string[],
  prefectures: readonly string[],
): boolean {
  if (regions.includes(regionName)) return true
  return prefectures.includes(prefecture)
}
