import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync('src/App.css', 'utf8')
const explore = readFileSync('src/features/explore/ExploreQuestList.tsx', 'utf8')
const records = readFileSync('src/features/discoveries/OwnerDiscoveries.tsx', 'utf8')

it('探索と記録が共通行を使い、写真行だけ高さを広げる', () => {
  expect(explore).toContain('traveler-list-row')
  expect(records).toContain('traveler-list-row traveler-list-row-photo')
  expect(css).toMatch(/\.traveler-list-row \{[^}]*min-height: 44px;[^}]*padding: 8px 12px;[^}]*border: 2px solid var\(--ui-line\);[^}]*border-radius: 12px;/)
  expect(css).toMatch(/\.traveler-list-row-photo \{[^}]*min-height: 64px;/)
  expect(css).not.toMatch(/explore-side-panel \.explore-quest-card \{/)
})

it('行の間隔、2行省略、右端メタデータ、キーボードフォーカスをそろえる', () => {
  expect(css).toMatch(/\.explore-quest-list \{[^}]*gap: 4px;/)
  expect(css).toMatch(/\.record-table tbody \{[^}]*gap: 4px;/)
  expect(css).toMatch(/\.traveler-row-title \{[^}]*-webkit-line-clamp: 2;/)
  expect(css).toMatch(/\.traveler-row-meta \{[^}]*text-align: right;[^}]*white-space: nowrap;/)
  expect(css).toMatch(/\.traveler-list-row:focus-within \{[^}]*background: var\(--ui-soft\);/)
  expect(css).toMatch(/\.traveler-list-row:focus-within \{[^}]*outline: 2px solid var\(--ui-line\);/)
  expect(css).toMatch(/\.traveler-list-row\.is-selected \{[^}]*background: var\(--ui-accent\);/)
})
