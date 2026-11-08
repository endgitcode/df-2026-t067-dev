import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf8')
const PLAIN_FIXED = '.map-preview-shell.has-sheet .map-controls { bottom: 72px; }'
const mapPreview = readFileSync(resolve(process.cwd(), 'src/features/explore/MapPreview.tsx'), 'utf8')

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

describe('bottom sheet close visibility timing', () => {
  it('delays hiding through the 300ms close and removes that delay for reduced motion', () => {
    expect(css).toContain('.explore-sheet[data-snap="closed"]:not(.is-dragging) .explore-sheet-body { visibility: hidden; transition: visibility 0s linear 300ms; }')
    expect(css).toContain('@media (prefers-reduced-motion: reduce) { .explore-sheet { transition: none; } .explore-sheet-body { transition: none !important; } }')
  })
})

// スマホ幅（981px未満）では主要ナビを画面下のタブバーに置く（D-32）。
// 縁なし表示でもタブバーは下に残り、シートと浮動要素はタブバーの高さぶん持ち上げる。
describe('mobile bottom tab bar (D-32)', () => {
  it('pins the mobile nav to the bottom as a tab bar with a shared height token', () => {
    expect(css).toContain(':root { --mobile-tabbar-h: calc(70px + env(safe-area-inset-bottom, 0px)); }')
    expect(css).toContain('.mobile-nav { position: fixed; bottom: 0; left: 0; right: 0;')
    expect(css).toContain('.mobile-nav [aria-current="page"] { background: var(--ui-accent);')
  })

  it('does not float the mobile nav over the map in full-bleed', () => {
    expect(css).not.toContain('body.explore-fullbleed .mobile-nav {')
  })

  it('keeps the mobile map controls fixed behind the sheet and the sheet above the tab bar', () => {
    expect(css).toContain('body.explore-fullbleed .explore-sheet { bottom: var(--mobile-tabbar-h); padding-bottom: 0; }')
    expect(css).toContain('body.explore-fullbleed .map-preview-shell.has-sheet .map-controls { bottom: calc(var(--mobile-tabbar-h) + 58px); z-index: 3; }')
    expect(css).toContain('body.explore-fullbleed .map-location-status.is-floating { bottom: calc(var(--sheet-h, 0px) + var(--mobile-tabbar-h) + 14px); }')
    expect(css).toContain('body.explore-fullbleed .explore-sheet-reopen { position: absolute;')
    expect(css).toContain('body.explore-fullbleed .explore-sheet-reopen { position: absolute; left: 12px; bottom: calc(var(--sheet-h, 0px) + var(--mobile-tabbar-h) + 10px); z-index: 6; display: block; min-height: 44px;')
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
    const rule = 'body.explore-fullbleed .explore-side-panel { position: fixed; top: calc(var(--pc-sidebar-gap) + var(--pc-sidebar-nav-h)); bottom: var(--pc-sidebar-gap); left: var(--pc-sidebar-gap);'
    expect(css).toContain(rule)
    expect(css.indexOf(rule)).toBeGreaterThan(mediaAt)
  })

  it('floats the primary nav as the top piece of the same card', () => {
    expect(css).toContain('body.explore-fullbleed .desktop-nav { position: fixed; top: var(--pc-sidebar-gap); left: var(--pc-sidebar-gap);')
    // ナビはカードの上半分（上の角だけ丸く）、パネルは下半分（下の角だけ丸く）。
    expect(css).toContain('border-radius: var(--radius-l) var(--radius-l) 0 0;')
    expect(css).toContain('border-radius: 0 0 var(--radius-l) var(--radius-l);')
  })

  it('keeps map-side floating UI clear of the panel zone', () => {
    expect(css).toContain('body.explore-fullbleed .site-header { position: fixed; top: 0; right: 0; left: var(--pc-sidebar-offset);')
    expect(css).toContain('body.explore-fullbleed .map-topline { left: calc(var(--pc-sidebar-offset) + 8px); }')
    expect(css).toContain('body.explore-fullbleed .map-location-status.is-floating { left: calc(var(--pc-sidebar-offset) + 8px);')
  })
})

describe('rounded corner scale (D-35)', () => {
  const themeCss = readFileSync(resolve(process.cwd(), 'src/theme.css'), 'utf8')

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

  it('keeps the floating brand a compact chip instead of a stretched bar', () => {
    expect(css).toContain('body.explore-fullbleed .brand { justify-self: start;')
  })

  it('collapses the sidebar by hiding the card only: the stage and the header do not move', () => {
    // D-42 以降、畳む時は display ではなく opacity / visibility / transform で
    // 滑らせて消す（非表示への切り替えは遷移の終わりに遅らせる）。
    expect(css).toContain('body.explore-fullbleed.explore-sidebar-collapsed .desktop-nav { opacity: 0; visibility: hidden;')
    expect(css).toContain('body.explore-fullbleed.explore-sidebar-collapsed .explore-side-panel { opacity: 0; visibility: hidden;')
    expect(css).not.toContain('body.explore-fullbleed.explore-sidebar-collapsed .site-header { left: 0; }')
    expect(css).not.toContain('body.explore-fullbleed.explore-sidebar-collapsed .explore-workspace')
    expect(css).toContain('body.explore-fullbleed .sidebar-toggle { position: fixed; top: 50%; left: calc(var(--pc-sidebar-gap) + var(--pc-sidebar-w));')
    // 閉じている間は左上に小さな浮動ボタンとして残る。
    expect(css).toContain('body.explore-fullbleed.explore-sidebar-collapsed .sidebar-toggle { top: var(--pc-sidebar-gap); left: var(--pc-sidebar-gap);')
  })
})

// UI の動き（D-42）: 入場は CSS、開閉は transition、曲線と尺はトークンで統一する。
describe('UI motion (D-42)', () => {
  const themeCss = readFileSync(resolve(process.cwd(), 'src/theme.css'), 'utf8')

  it('defines the strong easing tokens in the theme', () => {
    expect(themeCss).toContain('--ease-out: cubic-bezier(0.23, 1, 0.32, 1);')
    expect(themeCss).toContain('--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);')
    expect(themeCss).toContain('--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);')
  })

  it('glides the sheet snap with the drawer curve and delays hiding until the close finishes', () => {
    expect(css).toContain('transition: height 300ms var(--ease-drawer), visibility 0s;')
    expect(css).not.toContain('.explore-sheet[data-snap="closed"]:not(.is-dragging) { transition: height 300ms var(--ease-drawer), visibility 0s linear 300ms; }')
  })

  it('animates the quest details entrance and the view swap with the shared keyframes', () => {
    expect(css).toContain('@keyframes content-rise-in')
    expect(css).toContain('.quest-details { animation: content-rise-in 280ms var(--ease-out); }')
    expect(css).toContain('.view-enter { animation: view-fade-in 180ms var(--ease-out); }')
  })

  it('slides the floating sidebar card out instead of snapping it off', () => {
    expect(css).toContain('transition: opacity 200ms var(--ease-out), transform 200ms var(--ease-out), visibility 0s;')
    expect(css).toContain('transform: translateX(-12px); pointer-events: none; transition-delay: 0s, 0s, 200ms;')
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
