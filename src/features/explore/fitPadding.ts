import { SHEET_PEEK_HEIGHT } from './ExploreBottomSheet'

// フィット時のパディング。地図の上に重なる上部の帯・チップ、下のシートとタブバーの分を
// 差し引き、対象が「実際に見えている領域」の中央に来るようにする（Google マップの型）。
// PC幅は左パネルが地図の外にあるため、上に浮くヘッダー分と余白だけを見る。
export function visibleAreaFitPadding(wide: boolean): { top: number; right: number; bottom: number; left: number } {
  return wide
    ? { top: 88, right: 48, bottom: 48, left: 48 }
    : { top: 140, right: 16, bottom: SHEET_PEEK_HEIGHT + 84, left: 16 }
}
