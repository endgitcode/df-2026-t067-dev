import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import App from '../../App'
import type { AuthClient } from '../auth/authTypes'

const css = readFileSync('src/App.css', 'utf8')
const clearance = 'calc(var(--account-slot-top) + var(--account-slot-size) + 24px)'

describe('未ログインの記録カードの配置', () => {
  it('未ログインのカードにも認証状態に依存しない共通の上余白を適用する', async () => {
    const snapshot = { status: 'signed-out', user: null } as const
    const auth: AuthClient = {
      getSnapshot: () => snapshot, subscribe: () => () => {},
      signInWithGoogle: vi.fn(), signOut: vi.fn(), getIdToken: vi.fn(),
    }
    render(<App authClient={auth} apiMode apiDataMode="durable-local" />)
    const nav = screen.getByRole('navigation', { name: 'スマホ用ナビゲーション' })
    await userEvent.setup().click(within(nav).getByRole('button', { name: '自分の記録' }))
    const card = screen.getByRole('region', { name: '自分の記録' })
    expect(card).toHaveClass('owner-records')
    expect(card.closest('.traveler-shell')).not.toBeNull()
    expect(within(card).getByText('ログインすると記録が見られます')).toBeVisible()
    expect(within(card).getByRole('button', { name: 'Googleログインして記録を見る' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'ログイン' })).toHaveClass('account-icon-button')

    // 最後の共通規則をCSSOMで確認する。幅別・認証別の条件を付けない。
    const sheet = document.createElement('style')
    sheet.textContent = css
    document.head.append(sheet)
    try {
      const rules = Array.from(sheet.sheet!.cssRules)
      const shared = rules.filter((rule): rule is CSSStyleRule =>
        rule instanceof CSSStyleRule && rule.selectorText === 'body:has(.traveler-shell) .owner-records')
      expect(shared.at(-1)?.style.getPropertyValue('margin-top')).toBe(clearance)
      expect(css).toMatch(/\.account-area\s*\{[^}]*top: var\(--account-slot-top\)/)
      expect(css).toMatch(/\.account-icon-button\s*\{[^}]*height: var\(--account-slot-size\)/)
    } finally {
      sheet.remove()
    }
  })

  it('下部タブの通常・選択・操作状態の影を禁止する', () => {
    const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selector]) => selector.includes('.mobile-nav'))
    const shadows = blocks.flatMap(([, , body]) => [...body.matchAll(/box-shadow:\s*([^;}]*)/g)])
    expect(shadows.length).toBeGreaterThan(0)
    for (const [, value] of shadows) expect(value.trim()).toBe('none')
    expect(css).toMatch(/\.traveler-shell \.mobile-nav button\s*\{\s*box-shadow: none;/)
    expect(css).toMatch(/\.mobile-nav \[aria-current="page"\]\s*\{[^}]*background: var\(--ui-accent\);[^}]*border: var\(--ui-border-width\) solid var\(--ui-line\)/)
  })
})
