import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ExploreQuestList } from './ExploreQuestList'
import type { PublicArea, PublicQuest } from '../../shared/api/types'

const areas: PublicArea[] = [
  { areaId: 'area-a', label: '横浜', publishedCount: 2, marker: { latitude: 35, longitude: 139 },
    publicGeometry: { type: 'Polygon', coordinates: [[[139, 35], [140, 35], [140, 36], [139, 36], [139, 35]]] } },
  { areaId: 'area-b', label: '福岡', publishedCount: 1, marker: { latitude: 33, longitude: 130 },
    publicGeometry: { type: 'Polygon', coordinates: [[[130, 33], [131, 33], [131, 34], [130, 34], [130, 33]]] } },
]
const quests: PublicQuest[] = [
  { questId: 'q1', version: 1, title: '港の時計台', clue: '大きな時計が見える場所', areaId: 'area-a', visitConditions: '', hintCount: 3, hintImages: [null, 'https://example.test/hint.jpg'] },
  { questId: 'q2', version: 1, title: '博多の灯台', clue: '海に突き出た灯台', areaId: 'area-b', visitConditions: '', hintCount: 2 },
]

describe('ExploreQuestList', () => {
  it('shows the quest number on the card only when one is assigned', () => {
    const numbered: PublicQuest[] = [{ ...quests[0], questNumber: '14-01' }, quests[1]]
    render(<ExploreQuestList areas={areas} quests={numbered} onOpenQuest={() => {}} />)
    expect(screen.getByText('No. 14-01')).toBeVisible()
    expect(screen.queryByText(/No\. 40-/)).not.toBeInTheDocument()
  })
  it('renders quest cards with title, area, clue and a hint thumbnail', () => {
    render(<ExploreQuestList areas={areas} quests={quests} onOpenQuest={() => {}} />)
    expect(screen.getByRole('region', { name: '選べる謎の一覧' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'この範囲の謎' })).not.toBeInTheDocument()
    expect(screen.getByText('2件')).toBeVisible()
    expect(screen.getByText('港の時計台')).toBeVisible()
    expect(screen.getByText('横浜')).toBeVisible()
    expect(screen.getByText('大きな時計が見える場所')).toBeVisible()
    expect(screen.queryByText('ピンは地域の代表点です。問題の場所そのものではありません。')).not.toBeInTheDocument()
    const card = screen.getByRole('button', { name: '港の時計台の詳細を見る' }).closest('.explore-quest-card')
    expect(card?.querySelector('img')).toHaveAttribute('src', 'https://example.test/hint.jpg')
    expect(screen.getByRole('button', { name: '博多の灯台の詳細を見る' }).querySelector('img')).not.toBeInTheDocument()
  })

  it('opens the quest detail from a card', async () => {
    const user = userEvent.setup()
    const onOpenQuest = vi.fn()
    render(<ExploreQuestList areas={areas} quests={quests} onOpenQuest={onOpenQuest} />)
    await user.click(screen.getByRole('button', { name: '博多の灯台の詳細を見る' }))
    expect(onOpenQuest).toHaveBeenCalledWith('q2')
  })

  it('shows a cleared badge only for quests the owner already cleared', () => {
    render(<ExploreQuestList areas={areas} quests={quests} clearedQuestIds={new Set(['q1'])} onOpenQuest={() => {}} />)
    const clearedCard = screen.getByRole('button', { name: '港の時計台の詳細を見る' })
    expect(clearedCard).toHaveTextContent('クリア済み')
    expect(screen.getByRole('button', { name: '博多の灯台の詳細を見る' })).not.toHaveTextContent('クリア済み')
  })

  it('marks the selected quest card as pressed', () => {
    render(<ExploreQuestList areas={areas} quests={quests} selectedQuestId="q2" onOpenQuest={() => {}} />)
    expect(screen.getByRole('button', { name: '博多の灯台の詳細を見る' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '港の時計台の詳細を見る' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows a condition-based empty message when no quests match', () => {
    render(<ExploreQuestList areas={areas} quests={[]} />)
    expect(screen.getByText('選択中の条件に合う謎はありません。地方・都道府県の条件を変えると、別の謎が表示されます。')).toBeVisible()
    expect(screen.getByText('0件')).toBeVisible()
  })

  it('highlights the pinned area quests without rendering a summary bar', () => {
    const { container } = render(<ExploreQuestList areas={areas} quests={quests} highlightArea={areas[0]} onOpenQuest={() => {}} />)
    const highlighted = screen.getByRole('button', { name: '港の時計台の詳細を見る' }).closest('li')
    expect(highlighted).toHaveClass('is-highlighted')
    expect(screen.getByRole('button', { name: '博多の灯台の詳細を見る' }).closest('li')).not.toHaveClass('is-highlighted')
    // 選択中地域のサマリバー（地域名＋問数＋閉じる）は出さない（D-45）。地域名はカード側に既にある。
    expect(container.querySelector('.explore-list-focus')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '閉じる' })).not.toBeInTheDocument()
  })

  it('puts the pinned area quests first so they lead the list without scrolling', () => {
    render(<ExploreQuestList areas={areas} quests={quests} highlightArea={areas[1]} onOpenQuest={() => {}} />)
    const cards = screen.getAllByRole('button', { name: /の詳細を見る/ })
    expect(cards[0]).toHaveAccessibleName('博多の灯台の詳細を見る')
    expect(cards[1]).toHaveAccessibleName('港の時計台の詳細を見る')
  })

  it('renders the list without a heading when the map is unavailable', () => {
    render(<ExploreQuestList areas={areas} quests={quests} />)
    expect(screen.getByRole('region', { name: '選べる謎の一覧' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'すべての地域の謎' })).not.toBeInTheDocument()
    expect(screen.getByText('2件')).toBeVisible()
    expect(screen.getByText('博多の灯台')).toBeVisible()
  })
})
