import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
const css = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf8')

describe('boot shell chrome (F5 stable)', () => {
  it('matches the hydrated PC chrome pieces before React mounts', () => {
    expect(html).toContain('boot-brand-mark-pc')
    expect(html).toContain('boot-toggle')
    expect(html).toContain('boot-account')
    expect(html).toContain('全国観光謎アプリ')
    expect(html).toContain('謎を探す')
    expect(html).toContain('自分の記録')
    expect(html).toContain('#c7ed93')
    expect(html).toContain('.boot-map')
    expect(html).toMatch(/\.boot-map[^}]*background: #c5e8f5/)
    expect(html).toMatch(/boot-panel[\s\S]*boot-status[\s\S]*読み込み中/)
    expect(html).toMatch(/boot-nav[\s\S]*自分の記録[\s\S]*boot-panel/)
    expect(html).toContain('boot-skeleton')
  })
})

describe('side panel skeleton visibility (F5 stable)', () => {
  it('keeps tinted skeleton rows inside the flat side panel', () => {
    expect(css).toMatch(/explore-side-panel \.explore-quest-skeleton[^}]*background: var\(--ui-tint\)/)
  })
})

describe('boot chrome icon sizes match hydrated fullbleed chrome', () => {
  it('keeps PC brand mark at 32px / 20px glyph and mobile at 30px / 18px on both sides', () => {
    expect(html).toMatch(/\.boot-brand-mark-pc\s*\{[^}]*width: 32px; height: 32px/)
    expect(html).toMatch(/\.boot-brand-mark-pc \.boot-icon \{ width: 20px; height: 20px; \}/)
    expect(html).toMatch(/\.boot-brand-mark\s*\{[^}]*width: 30px; height: 30px/)
    expect(html).toMatch(/\.boot-brand-mark \.boot-icon \{ width: 18px; height: 18px; \}/)
    expect(css).toMatch(/explore-fullbleed \.brand-mark[^}]*width: 32px; height: 32px/)
    expect(css).toMatch(/explore-fullbleed \.brand-mark \.icon \{ width: 20px; height: 20px; \}/)
    expect(css).toMatch(/body\.explore-fullbleed \.brand-mark \{ width: 30px; height: 30px; border-radius: 12px; \}/)
    expect(css).toMatch(/body\.explore-fullbleed \.brand-mark \.icon \{ width: 18px; height: 18px; \}/)
  })

  it('keeps brand-mark corners at 12px (not the 16px surface radius) on both sides', () => {
    expect(html).toMatch(/\.boot-brand-mark[^{]*\{[^}]*border-radius: 12px/)
    expect(html).toMatch(/\.boot-brand-mark-pc\s*\{[^}]*border-radius: 12px/)
    expect(css).toMatch(/explore-fullbleed \.brand-mark[^}]*border-radius: 12px/)
  })

  it('keeps account / toggle / nav glyph sizes identical to boot', () => {
    expect(html).toMatch(/\.boot-account \.boot-icon \{ width: 20px; height: 20px; \}/)
    expect(html).toMatch(/\.boot-toggle \.boot-icon \{ width: 24px; height: 24px; \}/)
    expect(html).toMatch(/\.boot-icon \{[^}]*width: 18px; height: 18px/)
    expect(html).toMatch(/\.boot-tab \.boot-icon \{ width: 20px; height: 20px; \}/)
    expect(css).toMatch(/\.account-icon-button \.icon \{ width: 20px; height: 20px; \}/)
    expect(css).toMatch(/explore-fullbleed \.sidebar-toggle \.icon \{ width: 24px; height: 24px; \}/)
    expect(css).toMatch(/explore-fullbleed \.desktop-nav \.icon \{ width: 18px; height: 18px; \}/)
    expect(css).toMatch(/\.mobile-nav \.icon \{ width: 20px; height: 20px; \}/)
  })

  it('does not put an offset shadow on the boot brand chip (matches React D-66)', () => {
    expect(html).toMatch(/\.boot-brand-chip \{[^}]*border: 2px solid #1d1d1b/)
    expect(html).not.toMatch(/\.boot-brand-chip \{[^}]*box-shadow:/)
  })
})

describe('boot/React icon pixel match guards', () => {
  it('keeps boot tabs on React accent chrome (yellow active, line-height 1.2, weight 700)', () => {
    expect(html).toMatch(/\.boot-tab \{[^}]*line-height: 1\.2/)
    expect(html).toMatch(/\.boot-tab\.is-active \{[^}]*background: #ffe66b/)
    expect(html).toMatch(/\.boot-tab\.is-active \{[^}]*font-weight: 700/)
    expect(css).toMatch(/\.mobile-nav a, \.mobile-nav button \{[^}]*line-height: 1\.2/)
  })

  it('keeps sidebar toggle on opaque surface so SVG AA matches boot', () => {
    expect(html).toMatch(/\.boot-toggle \{[^}]*background: #ffffff/)
    expect(html).toMatch(/\.boot-toggle \{[^}]*border-radius: 10px/)
    expect(css).toMatch(/explore-fullbleed \.sidebar-toggle \{[^}]*background: var\(--ui-surface\)/)
  })

  it('keeps explore html/body map-blue so account circle corners do not flash cream', () => {
    const theme = readFileSync(resolve(process.cwd(), 'src/theme.css'), 'utf8')
    expect(theme).toMatch(/html:has\(body\.explore-fullbleed\) \{ background: var\(--ui-blue/)
    expect(theme).toMatch(/body \{[^}]*min-height: 100dvh/)
  })
})
