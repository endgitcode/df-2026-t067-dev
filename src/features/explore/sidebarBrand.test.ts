import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf8')

describe('sidebar brand collapse (t161u)', () => {
  it('keeps the brand mark at a constant 32px when collapsed', () => {
    expect(css).toMatch(/explore-sidebar-collapsed \.brand-mark[^}]*width: 32px; height: 32px/)
    expect(css).not.toMatch(/explore-sidebar-collapsed \.brand-mark[^}]*width: 28px/)
  })

  it('fades the app name with max-width/opacity instead of display:none wrap', () => {
    expect(css).toMatch(/explore-sidebar-collapsed \.brand-copy[^{]*\{[^}]*max-width: 0; opacity: 0/)
    expect(css).not.toMatch(/explore-sidebar-collapsed \.brand-copy \{ display: none; \}/)
    expect(css).toContain('white-space: nowrap; overflow: hidden')
  })
})

describe('sidebar icon column stability on collapse', () => {
  it('parks the toggle inside the collapsed rail without moving logo/nav icons', () => {
    // 開いたときは open-w 基準の右端
    expect(css).toContain('left: calc(var(--pc-sidebar-open-w) - 48px)')
    // 閉じたときは細い列の中（中央寄せ）・ナビ直下。外へはみ出さない
    expect(css).toMatch(/explore-sidebar-collapsed \.sidebar-toggle[^}]*left: calc\(\(var\(--pc-sidebar-rail-w\) - 44px\) \/ 2\)/)
    expect(css).toMatch(/explore-sidebar-collapsed \.sidebar-toggle[^}]*top: calc\(var\(--pc-sidebar-brand-h\) \+ var\(--pc-sidebar-nav-h\)\)/)
  })

  it('does not shove the nav icons down or enlarge them when collapsed', () => {
    expect(css).not.toMatch(/explore-sidebar-collapsed \.desktop-nav[^}]*top: 92px/)
    expect(css).not.toMatch(/explore-sidebar-collapsed \.desktop-nav \.icon[^}]*width: 22px/)
    expect(css).toMatch(/explore-sidebar-collapsed \.desktop-nav \.icon[^}]*width: 18px/)
    expect(css).toMatch(/explore-sidebar-collapsed \.brand[^}]*justify-content: flex-start/)
  })
})
