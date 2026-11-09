import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readCss = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n?/g, '\n')
const css = readCss('src/App.css')
const PLAIN_FIXED = '.map-preview-shell.has-sheet .map-controls { bottom: 72px; }'
const mapPreview = readFileSync(resolve(process.cwd(), 'src/features/explore/MapPreview.tsx'), 'utf8')
const bottomSheet = readFileSync(resolve(process.cwd(), 'src/features/explore/ExploreBottomSheet.tsx'), 'utf8')

// CSS の実測は jsdom ではできないため、規則の置き場所（構造）で担保する。
// 右下の地図操作系はシートの高さに追随せず、同じ場所に固定する。
describe('map controls placement with the bottom sheet', () => {
  it('keeps controls fixed in the full-width sheet range', () => {
    expect(css.split(PLAIN_FIXED).length - 1).toBe(1)
    const mediaAt = css.indexOf('@media (max-width: 640px)')
    expect(mediaAt).toBeGreaterThan(-1)
    expect(css.indexOf(PLAIN_FIXED)).toBeGreaterThan(mediaAt)
  })

  it('keeps the wide-layout controls at their fixed bottom position', () => {
    expect(css).toContain('.map-controls { position: absolute; right: 17px; bottom: 52px;')
  })

  it('puts controls above the closed mobile handle and the sheet above controls while open or dragging', () => {
    const mobileAt = css.indexOf('@media (max-width: 640px)')
    const desktopSheetRule = '.explore-sheet { position: absolute; left: 12px; bottom: 12px; z-index: 4;'
    const mobileSheetRule = '.explore-sheet { left: 0; right: 0; bottom: 0; z-index: 7;'
    expect(css).toContain(desktopSheetRule)
    expect(css.indexOf(mobileSheetRule)).toBeGreaterThan(mobileAt)
    expect(css).toContain('.map-controls { position: absolute; right: 17px; bottom: 52px; z-index: 6;')
    const closedRule = '.explore-sheet[data-snap="closed"]:not(.is-dragging) { z-index: 5; }'
    expect(css.indexOf(closedRule)).toBeGreaterThan(mobileAt)
    expect(css).toContain('.explore-sheet[data-snap="closed"]:not(.is-dragging) .explore-sheet-body { visibility: hidden; transition: visibility 0s linear 300ms; }')
    expect(css).not.toContain('.explore-sheet[data-snap="closed"]:not(.is-dragging) { visibility: hidden; pointer-events: none; }')
  })
})

describe('mobile map control swipe handling', () => {
  it('prevents page scrolling from map controls throughout the mobile-width range while leaving the sheet and lists scrollable', () => {
    const touchRule = '.map-controls, .explore-sheet-reopen, .map-state button { touch-action: none; overscroll-behavior: none; }'
    const mobileWidthAt = css.indexOf('@media (max-width: 980px)')
    const phoneWidthAt = css.indexOf('@media (max-width: 640px)')
    expect(mobileWidthAt).toBeGreaterThan(-1)
    expect(phoneWidthAt).toBeGreaterThan(mobileWidthAt)
    expect(css.indexOf(touchRule)).toBeGreaterThan(mobileWidthAt)
    expect(css.indexOf(touchRule)).toBeLessThan(phoneWidthAt)
    expect(css).not.toContain('.explore-sheet { touch-action: none;')
    expect(css).not.toContain('.explore-quest-list { touch-action: none;')
    expect(mapPreview).toContain('const mapControlGestureProps = {')
    expect(mapPreview).toContain('onPointerDownCapture: (event: ReactPointerEvent<HTMLElement>) => {')
    expect(mapPreview).toContain('if (gesture?.moved && event.detail !== 0) {')
    expect(mapPreview).toContain('<div className="map-controls" {...mapControlGestureProps}>')
    expect(mapPreview).toContain('<button type="button" {...mapControlGestureProps}')
    expect(bottomSheet).toContain('className="explore-sheet-reopen" {...reopenGestureProps}')
    expect(bottomSheet).toContain('if (gesture?.moved && event.detail !== 0) {')
  })
})

describe('bottom sheet close visibility timing', () => {
  it('delays hiding through the 300ms close and removes that delay for reduced motion', () => {
    expect(css).toContain('.explore-sheet[data-snap="closed"]:not(.is-dragging) .explore-sheet-body { visibility: hidden; transition: visibility 0s linear 300ms; }')
    expect(css).toContain('@media (prefers-reduced-motion: reduce) { .explore-sheet { transition: height 120ms linear, visibility 0s; } .explore-sheet.is-dragging { transition: none; } .explore-sheet-body { transition: none !important; } }')
  })
})

// スマホ幅（981px未満）では主要ナビを画面下のタブバーに置く（D-32）。
// 縁なし表示でもタブバーは下に残り、シートと浮動要素はタブバーの高さぶん持ち上げる。
describe('mobile bottom tab bar (D-32)', () => {
  it('pins the mobile nav to the bottom as a tab bar with a shared height token', () => {
    expect(css).toContain(':root { --mobile-tabbar-h: calc(70px + env(safe-area-inset-bottom, 0px)); }')
    expect(css).toContain('.mobile-nav { position: fixed; bottom: 0; left: 0; right: 0;')
    // タブバー上で始まった縦ジェスチャーはページスクロールへ渡さない。
    // タップは通常の click として残り、地図シートのスクロール領域には適用しない。
    expect(css).toContain('background: var(--ui-surface); touch-action: none; overscroll-behavior: none; }')
    expect(css).toContain('.mobile-nav [aria-current="page"] { background: var(--ui-accent);')
  })

  it('does not float the mobile nav over the map in full-bleed', () => {
    expect(css).not.toContain('body.explore-fullbleed .mobile-nav {')
  })

  it('keeps the mobile map controls fixed behind the sheet and the sheet above the tab bar', () => {
    expect(css).toContain('body.explore-fullbleed .explore-sheet { bottom: var(--mobile-tabbar-h); padding-bottom: 0; }')
    expect(css).toContain('body.explore-fullbleed .map-preview-shell.has-sheet .map-controls { bottom: calc(var(--mobile-tabbar-h) + min(var(--sheet-h, 0px), 168px) + 12px); z-index: 3; }')
    expect(css).toContain('body.explore-fullbleed .map-location-status.is-floating { bottom: calc(var(--sheet-h, 0px) + var(--mobile-tabbar-h) + 14px); }')
    const reopenRule = 'body.explore-fullbleed .explore-sheet-reopen { position: absolute; left: 12px; bottom: calc(var(--mobile-tabbar-h) + 48px); z-index: 3; display: block; min-height: 44px;'
    expect(css).toContain(reopenRule)
    expect(css).toContain('body.explore-fullbleed .map-browse-shortcut { position: fixed; bottom: calc(var(--mobile-tabbar-h) + 48px); z-index: 3; }')
    expect(css).toContain('body.explore-fullbleed .map-browse-shortcut.is-return-to-map { bottom: calc(var(--mobile-tabbar-h) + 10px); z-index: 8; }')
    expect(css).toContain('body.explore-fullbleed .map-browse-shortcut[inert] { visibility: hidden; pointer-events: none; }')
    expect(css).not.toContain('bottom: calc(var(--sheet-h, 0px) + var(--mobile-tabbar-h) + 10px); z-index: 6;')
    // 同じ固定位置のまま、通常時・ドラッグ中ともシート（z-index 7）の背面に残す。
    expect(css).toContain('.explore-sheet { position: absolute; left: 12px; bottom: 12px; z-index: 4;')
    expect(css).toContain('.explore-sheet { left: 0; right: 0; bottom: 0; z-index: 7;')
    expect(css).not.toContain('.explore-sheet.is-dragging { z-index:')
  })

  it('stacks the area chip after the filter flow so one and two filter rows cannot overlap it', () => {
    expect(mapPreview).toContain('<div className="map-filter-overlay">{topOverlay}{focusArea && <div className="map-topline">')
    expect(css).toContain('.map-filter-overlay { position: absolute; top: 78px; left: 20px; right: 20px; z-index: 3; display: flex; flex-direction: column; align-items: flex-start; gap: 8px;')
    expect(css).toContain('body.explore-fullbleed .map-filter-overlay { top: calc(env(safe-area-inset-top) + 58px); left: 12px; right: 12px; }')
    expect(css).not.toContain('body.explore-fullbleed .map-topline { top:')
    expect(css).toContain('.map-topline.is-sidebar { position: absolute; top: calc(env(safe-area-inset-top) + 88px);')
    expect(css).toContain('.map-filter-panel { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; width: 100%; min-width: 0; }')
  })

  it('keeps the records screen clear of the tab bar', () => {
    expect(css).toContain('.owner-records { padding-bottom: calc(var(--mobile-tabbar-h) + 20px); }')
  })
})

// PC幅（981px以上）の縁なし表示は左サイドバー方式（D-34）。サイドバーは押し出し式ではなく、
// 地図の上に浮くカード型（D-38）で、地図は常に画面いっぱい。シート前提の規則とは幅で分ける。
describe('PC floating sidebar (D-38)', () => {
  it('floats the sidebar as a card over a full-width map instead of offsetting the stage', () => {
    const mediaAt = css.indexOf('@media (min-width: 981px)')
    expect(mediaAt).toBeGreaterThan(-1)
    // 地図ステージはオフセットしない。ワークスペースの padding やシェルへの inset で
    // 押し出すと、相対配置と重なって二重に効く（2026-11-08 の実機報告）。
    expect(css).not.toContain('body.explore-fullbleed .explore-workspace { padding-left:')
    expect(css).not.toContain('.map-preview-shell { inset: 0 0 0 var(--pc-sidebar-w); }')
    expect(css).toContain('body.explore-fullbleed .explore-side-panel {')
    expect(css).toContain('top: var(--pc-sidebar-chrome-h); bottom: 0; left: 0;')
    expect(css.indexOf('top: var(--pc-sidebar-chrome-h);')).toBeGreaterThan(mediaAt)
  })

  it('places the primary nav as vertical rows under the brand row', () => {
    expect(css).toContain('body.explore-fullbleed .desktop-nav {')
    expect(css).toContain('top: var(--pc-sidebar-brand-h); left: 0;')
    expect(css).toContain('flex-direction: column;')
    expect(css).toContain('font-size: 14px;')
    // シートの上角丸はボトムシート側で維持（サイドバーはフラットカラム）。
    expect(css).toContain('border-radius: var(--radius-l) var(--radius-l) 0 0;')
  })

  it('keeps map-side floating UI clear of the panel zone', () => {
    expect(css).toContain('body.explore-fullbleed .site-header {')
    expect(css).toContain('left: var(--pc-sidebar-offset);')
    expect(css).toContain('body.explore-fullbleed .map-topline { left: calc(var(--pc-sidebar-offset) + 12px); }')
    expect(css).toContain('left: calc(var(--pc-sidebar-offset) + 12px);')
  })
})

describe('rounded corner scale (D-35)', () => {
  const themeCss = readCss('src/theme.css')

  it('defines a three-step radius scale and keeps --ui-radius as the middle alias', () => {
    expect(themeCss).toContain('--radius-s: 10px;')
    expect(themeCss).toContain('--radius-m: 16px;')
    expect(themeCss).toContain('--radius-l: 24px;')
    expect(themeCss).toContain('--ui-radius: var(--radius-m);')
  })

  it('gives the bottom sheet the large radius on its top corners', () => {
    expect(css).toContain('border-radius: var(--radius-l) var(--radius-l) 0 0;')
  })
})

describe('PC sidebar layout integrity', () => {
  it('never offsets the map stage: no workspace padding, no shell inset', () => {
    // シェルは position: relative のため、inset を重ねると相対オフセットとして二重に効く。
    expect(css).not.toContain('.map-preview-shell { inset: 0 0 0 var(--pc-sidebar-w); }')
    expect(css).not.toContain('body.explore-fullbleed .explore-workspace { padding-left:')
  })

  it('keeps the floating brand a compact chip on mobile and a sidebar row on PC', () => {
    expect(css).toContain('body.explore-fullbleed .brand { justify-self: start;')
    expect(css).toContain('body.explore-fullbleed .brand {')
    expect(css).toContain('height: var(--pc-sidebar-brand-h);')
  })

  it('collapses to an icon rail (~56px): list hides, brand/nav/toggle stay, stage is not padded away', () => {
    expect(css).toContain('--pc-sidebar-rail-w: 56px;')
    expect(css).toContain('body.explore-fullbleed.explore-sidebar-collapsed {')
    expect(css).toContain('--pc-sidebar-w: var(--pc-sidebar-rail-w);')
    expect(css).toContain('body.explore-fullbleed.explore-sidebar-collapsed .explore-side-panel {')
    expect(css).toContain('opacity: 0; visibility: hidden;')
    expect(css).not.toContain('body.explore-fullbleed.explore-sidebar-collapsed .desktop-nav { opacity: 0;')
    expect(css).not.toContain('body.explore-fullbleed.explore-sidebar-collapsed .site-header { left: 0; }')
    expect(css).not.toContain('body.explore-fullbleed.explore-sidebar-collapsed .explore-workspace')
    expect(css).toContain('body.explore-fullbleed .sidebar-toggle {')
    expect(css).toContain('width: 44px; height: 44px;')
    expect(css).toContain('body.explore-fullbleed.explore-sidebar-collapsed .sidebar-toggle { left: 6px;')
  })
})

// UI の動き（D-42）: 入場は CSS、開閉は transition、曲線と尺はトークンで統一する。
describe('UI motion (D-42)', () => {
  const themeCss = readCss('src/theme.css')

  it('defines the strong easing tokens in the theme', () => {
    expect(themeCss).toContain('--ease-out: cubic-bezier(0.23, 1, 0.32, 1);')
    expect(themeCss).toContain('--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);')
    expect(themeCss).toContain('--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);')
  })

  it('glides the sheet snap with the drawer curve and delays hiding until the close finishes', () => {
    expect(css).toContain('transition: height var(--sheet-release-ms, 300ms) var(--ease-drawer), visibility 0s;')
    expect(css).not.toContain('.explore-sheet[data-snap="closed"]:not(.is-dragging) { transition: height 300ms var(--ease-drawer), visibility 0s linear 300ms; }')
  })

  it('animates the quest details entrance and the view swap with the shared keyframes', () => {
    expect(css).toContain('@keyframes content-rise-in')
    expect(css).toContain('.quest-details { animation: content-rise-in 280ms var(--ease-out); }')
    expect(css).toContain('.view-enter { animation: view-fade-in 180ms var(--ease-out); }')
  })

  it('fades the list panel out on collapse while the icon rail width transitions', () => {
    expect(css).toContain('transition: width 200ms var(--ease-out), opacity 200ms var(--ease-out), visibility 0s;')
    expect(css).toContain('opacity: 0; visibility: hidden; pointer-events: none;')
  })
})

describe('mobile fullbleed finish', () => {
  it('keeps the peek sheet compact: rows are title-only at every snap (D-46)', () => {
    // 行そのものがタイトルだけの形になったため、peek 専用の抜粋・サムネイル隠しは不要になった。
    expect(css).not.toContain('.explore-quest-clue')
    expect(css).not.toContain('.explore-quest-card > img')
    expect(css).toContain('.explore-quest-detail { margin-top: 10px; }')
  })

  it('shrinks the floating brand into a small chip on narrow fullbleed screens', () => {
    expect(css).toContain('body.explore-fullbleed .brand-mark { width: 30px; height: 30px; }')
    expect(css).toContain('body.explore-fullbleed .brand-copy { font-size: 13px; }')
    expect(css).toContain('body.explore-fullbleed .map-filter-overlay { top: calc(env(safe-area-inset-top) + 58px); left: 12px; right: 12px; }')
  })
})

// 見た目と余白（D-54）: 区切り線と影を絞り、チップの左ラインとパネル下部を整える。
describe('look and spacing (D-54)', () => {
  it('drops the half-length divider under the quest details and the offset shadows on rows, tabs and the account icon', () => {
    expect(css).not.toContain('.quest-details { border-top')
    expect(css).toContain('.explore-quest-card { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; border: var(--ui-border-width) solid var(--ui-line); border-radius: var(--ui-radius); background: var(--ui-surface); color: var(--ui-ink); font: inherit; text-align: left; transition: background-color 150ms var(--ease-out); }')
    expect(css).not.toContain('body.explore-fullbleed .account-icon-button { box-shadow')
    expect(css).not.toContain('box-shadow: 6px 0 0 var(--ui-line)')
    // パネル本体の影は D-66 で外した（右端は枠線2pxだけになる）。
    expect(css).toContain('body.explore-fullbleed .explore-side-panel {')
    expect(css).toContain('position: fixed; top: var(--pc-sidebar-chrome-h); bottom: 0; left: 0;')
    expect(css).toContain('border-radius: 0; padding: 0 10px 16px;')
    expect(css).toContain('body.explore-fullbleed .explore-side-panel .explore-quest-card {')
    expect(css).toContain('border: 0; border-radius: var(--radius-s);')
  })

  it('aligns the floating title chip line with the panel side, open and collapsed', () => {
    expect(css).toContain('left: var(--pc-sidebar-offset); z-index: 25;')
    expect(css).toContain('grid-template-columns: 1fr auto; padding-left: 12px;')
    expect(css).toContain('body.explore-fullbleed.explore-sidebar-collapsed .site-header { left: var(--pc-sidebar-rail-w); }')
    expect(css).toContain('body.explore-fullbleed.explore-sidebar-collapsed .map-topline { left: calc(var(--pc-sidebar-rail-w) + 12px); }')
  })

  it('keeps a single panel scroller with a stable gutter (D-70 supersedes the D-54 list scroller)', () => {
    // スクロールはパネル本体だけが担い、一覧リスト側は伸縮もスクロールもしない。
    expect(css).toContain('body.explore-fullbleed .explore-side-panel .explore-list {')
    expect(css).toContain('position: relative; flex: 0 0 auto;')
    expect(css).toContain('flex: none; max-height: none; overflow: visible; padding-bottom: 12px;')
    expect(css).not.toContain('.explore-side-panel .explore-list::after')
    expect(css).toContain('.explore-quest-list { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; max-height: 344px; overflow: auto; scrollbar-gutter: stable; }')
    expect(css).toContain('overflow-y: auto; scrollbar-gutter: stable;')
    expect(css).toContain('display: flex; flex-direction: column;')
  })
})

// トグル化とアニメーション（D-55）: 「場所で絞る」の開閉を高さと透明度で滑らせる。
describe('filter motion (D-55)', () => {
  it('animates the filter chips wrap with the shared ease-out token and respects reduced motion', () => {
    expect(css).toContain('.map-filter-chips-wrap { display: grid; grid-template-rows: 0fr; opacity: 0; visibility: hidden; transition: grid-template-rows 250ms var(--ease-out), opacity 200ms var(--ease-out), visibility 0s linear 250ms; }')
    expect(css).toContain('.map-filter-chips-wrap.is-open { grid-template-rows: 1fr; opacity: 1; visibility: visible;')
    expect(css).toContain('@media (prefers-reduced-motion: reduce) { .map-filter-chips-wrap { transition: none; } }')
    expect(css).toContain('.filter-chip { flex: none; min-height: 40px; padding: 6px 13px; border: var(--ui-border-width) solid var(--ui-line); border-radius: 999px; background: var(--ui-surface); color: var(--ui-ink); font-size: 12px; font-weight: var(--ui-weight-control); white-space: nowrap; cursor: pointer; transition: background-color 150ms var(--ease-out); }')
  })

  it('glides the floating elements sideways when the PC sidebar collapses', () => {
    expect(css).toContain('body.explore-fullbleed .site-header,')
    expect(css).toContain('body.explore-fullbleed .map-topline,')
    expect(css).toContain('transition: left 200ms var(--ease-out), width 200ms var(--ease-out), top 200ms var(--ease-out);')
  })
})

// 記録画面のタブ位置（D-60 追記）: 非探索画面でもタブ群を探索画面のナビカードと
// 同じ左のライン（左カラム上段）に置く。CSS の実測は jsdom ではできないため、
// 規則の置き場所（記録画面が表示されている間だけ・PC 幅だけ）で担保する。
describe('records view tab position (D-60 addendum)', () => {
  it('keeps a vertical left sidebar (brand + nav) while records are shown on PC', () => {
    expect(css).toContain('body:has(.owner-records:not([hidden])) .desktop-nav {')
    expect(css).toContain('flex-direction: column;')
    expect(css).toContain('body:has(.owner-records:not([hidden])) .owner-records {')
    expect(css).toContain('margin-left: var(--pc-sidebar-w);')
    expect(css).toContain('body.explore-fullbleed .desktop-nav {')
    expect(css).toContain('top: var(--pc-sidebar-brand-h); left: 0;')
  })
})

// 見た目の統一（D-66）: 中身とパネル本体のオフセットシャドウを全廃し、タイトルと
// アカウントアイコンを画面間で同位置・同形に固定する。実測はライブの画素測定
// （2026-11-09、revision 00097）に基づく。CSS の実測は jsdom ではできないため、
// 規則の置き場所と文字列で担保する。
describe('chrome consistency (D-66)', () => {
  const themeCss = readCss('src/theme.css')

  it('drops the offset shadow from the shared control rule (detail and hint buttons, account icon), including hover', () => {
    expect(themeCss).not.toContain('box-shadow: var(--ui-control-shadow)')
    expect(themeCss).not.toContain('box-shadow: var(--ui-hover-shadow)')
    // 共通規則は枠線だけで示し、押下時と同じく影なしに揃える。
    expect(themeCss).toContain('border-radius: var(--ui-radius);\n  box-shadow: none;')
  })

  it('drops the offset shadow from the title pill, the brand mark, the side panel and the sheet', () => {
    // スマホ幅フルブリードのタイトルピル（PCはサイドバー内ブランドへ上書き）。
    expect(css).toContain('body.explore-fullbleed .brand { justify-self: start; width: fit-content; padding: 5px 11px 5px 5px; border: var(--ui-border-width) solid var(--ui-line); border-radius: var(--ui-radius); background: var(--ui-surface); }')
    expect(css).toContain('.brand-mark { border: var(--ui-border-width) solid var(--ui-line); background: var(--ui-tint); color: var(--ui-ink); }')
    expect(css).not.toContain('border-radius: 0 0 var(--radius-l) var(--radius-l); box-shadow: var(--ui-shadow);')
    expect(css).toContain('border-radius: 0; padding: 0 10px 16px;')
    expect(css).not.toContain('background: var(--ui-surface); color: var(--ui-ink); box-shadow: var(--ui-shadow); transition: height 300ms var(--ease-drawer), visibility 0s; }')
  })

  it('keeps records chrome aligned: mobile title pill, PC left sidebar, account at the right edge', () => {
    expect(css).toContain('@media (max-width: 980px) {\n  body:has(.owner-records:not([hidden])) .brand { justify-self: start; width: fit-content; padding: 4px 10px 4px 4px; border: var(--ui-border-width) solid var(--ui-line); border-radius: var(--ui-radius); background: var(--ui-surface); }')
    expect(css).toContain('body:has(.owner-records:not([hidden])) .site-header {\n    min-height: 0; grid-template-columns: 1fr auto;\n    padding: 10px 20px 16px calc(var(--pc-sidebar-w) + 16px);')
  })
})

// パネルの単一スクロールと一覧内詳細の枠なし化（D-70）。CSS の実測は jsdom では
// できないため、規則の文字列と置き場所で担保する。
describe('panel single scroll and in-list detail (D-70)', () => {
  it('makes the PC side panel the only scroller for the quest list', () => {
    expect(css).toContain('body.explore-fullbleed .explore-side-panel .explore-list {')
    expect(css).toContain('position: relative; flex: 0 0 auto;')
    expect(css).toContain('flex: none; max-height: none; overflow: visible; padding-bottom: 12px;')
    expect(css).not.toContain('.explore-side-panel .explore-list::after')
  })

  it('drops the detail card frame inside the list accordion', () => {
    expect(css).toContain('.quest-card.is-in-list { border: 0; border-radius: 0; background: transparent; box-shadow: none; }')
    expect(css).toContain('.quest-card.is-in-list .quest-card-heading { padding: 14px 16px 0; border-bottom: 0; background: transparent; }')
    expect(css).toContain('.quest-card.is-in-list .quest-card-content { padding: 12px 16px 16px; }')
  })

  it('raises the sheet for quest selection and fits selections above the raised sheet', () => {
    expect(mapPreview).toContain("selectedQuestId ? `quest:${selectedQuestId}` : null")
    expect(mapPreview).toContain('Math.max(SHEET_PEEK_HEIGHT, Math.round(stageHeight * 0.55))')
  })
})

// シートの高さ・はみ出し・チップの折り返し（D-73）。CSS の実測は jsdom ではできないため、
// 規則の文字列と定数で担保する。
describe('sheet peek height and overflow guards (D-73)', () => {
  it('clears the mobile map controls above the peek sheet via the sheet height variable', () => {
    expect(css).toContain('body.explore-fullbleed .map-controls { bottom: calc(var(--mobile-tabbar-h) + min(var(--sheet-h, 0px), 168px) + 12px); }')
    expect(css).not.toContain('bottom: calc(var(--mobile-tabbar-h) + 58px)')
  })

  it('keeps the full-bleed page free of phantom vertical growth and puts the clearance on the rail', () => {
    expect(css).toContain('body.explore-fullbleed .page { padding-bottom: 0; }')
    expect(css).toContain('body.explore-fullbleed .quest-rail { padding: 22px 16px calc(var(--mobile-tabbar-h) + 25px); }')
    expect(css).toContain('body.explore-fullbleed .quest-rail:empty { display: none; }')
  })

  it('clips horizontal overflow at the viewport and wraps the region chips', () => {
    expect(css).toContain('html, body { overflow-x: clip; }')
    expect(css).toContain('.map-filter-chips { display: flex; flex-wrap: wrap; gap: 8px; max-width: 100%; overflow: visible; padding: 2px; pointer-events: auto; }')
    expect(css).not.toContain('.map-filter-chips::-webkit-scrollbar')
  })
})

// ボタンの尺と記録画面の統一（D-74）。CSS の実測は jsdom ではできないため、
// 規則の文字列と置き場所で担保する。
describe('button widths and records alignment (D-74)', () => {
  it('stretches the hint buttons across their frame', () => {
    expect(css).toContain('.hint-open, .hint-next {')
    expect(css).toContain('width: 100%; min-height: 52px;')
    expect(css).toContain('.optional-hint-toggle, .optional-hint-content button { width: 100%; min-height: 52px;')
  })

  it('keeps the PC handoff emphasis on the direct start and widens the records body column', () => {
    expect(css).toContain('.quest-handoff-toggle { width: 100%; min-height: 44px;')
    expect(css).not.toContain('.quest-handoff-direct')
    expect(css).toContain('.owner-records { display: grid; gap: 16px; max-width: 1080px; }')
  })

  it('gives the mobile records header the same transparent floating look as explore', () => {
    const mediaAt = css.indexOf('@media (max-width: 980px) {\n  body:has(.owner-records:not([hidden])) .brand')
    expect(mediaAt).toBeGreaterThan(-1)
    expect(css).toContain('body:has(.owner-records:not([hidden])) .site-header { background: transparent; border-bottom: 0; padding: calc(6px + env(safe-area-inset-top)) 10px 6px; }')
  })
})
