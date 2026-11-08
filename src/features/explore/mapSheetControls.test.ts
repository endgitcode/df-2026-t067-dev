import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf8')
const PLAIN_FOLLOW = '.map-preview-shell.has-sheet .map-controls { bottom: calc(var(--sheet-h, 0px) + 14px); }'

// CSS の実測は jsdom ではできないため、規則の置き場所（構造）で担保する。
// 右下の地図操作系がシートの高さに追随するのは、シートが横幅いっぱいに広がる幅だけに限る。
// 広い幅ではシートは左下の浮きカードであり、右側の操作系は通常位置に固定する。
describe('map controls placement with the bottom sheet', () => {
  it('follows the sheet height only in the full-width sheet range', () => {
    expect(css.split(PLAIN_FOLLOW).length - 1).toBe(1)
    const mediaAt = css.indexOf('@media (max-width: 640px)')
    expect(mediaAt).toBeGreaterThan(-1)
    expect(css.indexOf(PLAIN_FOLLOW)).toBeGreaterThan(mediaAt)
  })

  it('keeps the wide-layout controls at their fixed bottom position', () => {
    expect(css).toContain('.map-controls { position: absolute; right: 17px; bottom: 52px;')
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

  it('lifts the sheet and floating elements above the tab bar in full-bleed', () => {
    expect(css).toContain('body.explore-fullbleed .explore-sheet { bottom: var(--mobile-tabbar-h); padding-bottom: 0; }')
    expect(css).toContain('body.explore-fullbleed .map-preview-shell.has-sheet .map-controls { bottom: calc(var(--sheet-h, 0px) + var(--mobile-tabbar-h) + 14px); }')
    expect(css).toContain('body.explore-fullbleed .map-location-status.is-floating { bottom: calc(var(--sheet-h, 0px) + var(--mobile-tabbar-h) + 14px); }')
  })

  it('keeps the records screen clear of the tab bar', () => {
    expect(css).toContain('.owner-records { padding-bottom: calc(var(--mobile-tabbar-h) + 20px); }')
  })
})

// PC幅（981px以上）の縁なし表示は左サイドバー方式（D-34）: 地図はサイドバーの右側に広げ、
// ナビとパネルを左の固定列に入れる。シート前提の規則とは幅で分ける。
describe('PC left sidebar (D-34)', () => {
  it('offsets the full-bleed map stage by the sidebar width on wide viewports', () => {
    const mediaAt = css.indexOf('@media (min-width: 981px)')
    expect(mediaAt).toBeGreaterThan(-1)
    // オフセットはワークスペースの padding-left のみ。シェルへの inset は相対配置と
    // 重なって二重に効くため置かない（2026-11-08 の実機報告で修正）。
    const rule = 'body.explore-fullbleed .explore-workspace { padding-left: var(--pc-sidebar-w); }'
    expect(css).toContain(rule)
    expect(css).not.toContain('.map-preview-shell { inset: 0 0 0 var(--pc-sidebar-w); }')
    expect(css.indexOf(rule)).toBeGreaterThan(mediaAt)
  })

  it('fixes the primary nav and the side panel into the left column', () => {
    expect(css).toContain('body.explore-fullbleed .desktop-nav { position: fixed; top: 0; left: 0;')
    expect(css).toContain('body.explore-fullbleed .explore-side-panel { position: fixed; top: var(--pc-sidebar-nav-h); bottom: 0; left: 0;')
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
  it('offsets the stage only via the workspace padding, never via the shell inset', () => {
    // シェルは position: relative のため、inset を重ねると相対オフセットとして二重に効く。
    expect(css).not.toContain('.map-preview-shell { inset: 0 0 0 var(--pc-sidebar-w); }')
    expect(css).toContain('body.explore-fullbleed .explore-workspace { padding-left: var(--pc-sidebar-w); }')
  })

  it('keeps the floating brand a compact chip instead of a stretched bar', () => {
    expect(css).toContain('body.explore-fullbleed .brand { justify-self: start;')
  })
})

describe('mobile fullbleed finish', () => {
  it('keeps the peek sheet compact: note, clue excerpt and thumbnail are hidden at peek only', () => {
    expect(css).toContain('.explore-sheet[data-snap="peek"] .explore-list-note { display: none; }')
    expect(css).toContain('.explore-sheet[data-snap="peek"] .explore-quest-clue { display: none; }')
    expect(css).toContain('.explore-sheet[data-snap="peek"] .explore-quest-card > img { display: none; }')
  })

  it('shrinks the floating brand into a small chip on narrow fullbleed screens', () => {
    expect(css).toContain('body.explore-fullbleed .brand-mark { width: 30px; height: 30px; }')
    expect(css).toContain('body.explore-fullbleed .brand-copy { font-size: 13px; }')
    expect(css).toContain('body.explore-fullbleed .map-topline { top: calc(env(safe-area-inset-top) + 64px); left: 12px; right: 12px; }')
  })
})
