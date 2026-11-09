import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/features/admin/admin.css', 'utf8')

// These contracts cover the later managed/workflow overrides as well as the base form.
describe('管理画面の見た目の規則', () => {
  it('共有・永続カードは黒2px、角丸16、影なし', () => {
    expect(css).toContain('.admin-managed .form-section { border: 2px solid var(--ui-line); border-radius: 16px; box-shadow: none; }')
    expect(css).toContain('--ui-shadow: none; --ui-control-shadow: none;')
    expect(css).not.toMatch(/border(?:-top)?: 1px|border-width: 1px|#e2e5e9/)
  })
  it('主操作は黄色、48px、副操作は44px以上・角丸12', () => {
    expect(css).toContain('.admin-managed .workflow-primary { background: var(--ui-accent); color: var(--ui-accent-ink); border-color: var(--ui-line); }')
    expect(css).toMatch(/\.admin-demo \.workflow-primary \{ min-height: 48px; \}/)
    expect(css).toMatch(/\.admin-demo button,\s*\.admin-demo input::file-selector-button \{ min-height: 44px; border-radius: 12px; \}/)
  })
  it('入力欄は44px以上、角丸12でキーボードフォーカスを示す', () => {
    expect(css).toMatch(/\.admin-demo select \{ min-height: 44px;/)
    expect(css).toMatch(/\.admin-demo select \{ border-radius: 12px; \}/)
    expect(css).toContain('.admin-demo :focus-visible { outline: 3px solid var(--ui-focus);')
    expect(css).toContain('.admin-demo [aria-invalid="true"]')
  })
  it('余白はPC24px・スマホ16pxで、工程内の面も16pxを保つ', () => {
    expect(css).toContain('padding: 24px 24px 64px')
    expect(css).toContain('.form-section, .traveler-card { padding: 16px; }')
    expect(css).toContain('padding: 16px 16px 48px')
    expect(css).toContain('.admin-workflow .form-section { padding: 16px; }')
  })
  it('旅行者への入口は右上固定の44px副ボタン', () => {
    const rule = css.match(/\.admin-demo \.admin-traveler-link \{([^}]+)\}/)?.[1]
    for (const declaration of ['position: fixed;', 'top: 16px;', 'right: 16px;', 'min-height: 44px;', 'border: 2px solid var(--ui-line);', 'border-radius: 12px;', 'background: var(--ui-surface);']) {
      expect(rule).toContain(declaration)
    }
  })
})
