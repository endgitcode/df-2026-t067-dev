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
    // 緑のロゴ下地（本物の brand-mark と同じ --ui-tint）
    expect(html).toContain('#c7ed93')
    // 地図面は最初から水色（Maps の灰色を挟まない）
    expect(html).toContain('.boot-map')
    expect(html).toMatch(/\.boot-map[^}]*background: #c5e8f5/)
    // 仮カードをパネル内に置き、ナビ文言と「読み込み中」を重ねない
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
