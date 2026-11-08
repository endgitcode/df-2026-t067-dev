import { SHEET_PEEK_HEIGHT } from './ExploreBottomSheet'

// フィット時のパディング。地図の上に重なる上部の帯・チップ、下のシートとタブバーの分を
// 差し引き、対象が「実際に見えている領域」の中央に来るようにする（Google マップの型）。
// PC幅のサイドバーは地図の上に浮くカード型（D-37）のため、開いている間は左パディングに
// パネル幅と周囲の余白を見込む。閉じている間は通常の余白だけにする。
// （380px は CSS の --pc-sidebar-w、16px は --pc-sidebar-gap と揃える。）
// 開閉そのものでは再フィットしない（開閉で地図の中心を動かさないため、D-37）。
const PC_SIDEBAR_FIT_LEFT = 380 + 16 * 2 + 36
export function visibleAreaFitPadding(wide: boolean, sidebarCollapsed = false): { top: number; right: number; bottom: number; left: number } {
  return wide
    ? { top: 88, right: 48, bottom: 48, left: sidebarCollapsed ? 48 : PC_SIDEBAR_FIT_LEFT }
    : { top: 140, right: 16, bottom: SHEET_PEEK_HEIGHT + 84, left: 16 }
}
