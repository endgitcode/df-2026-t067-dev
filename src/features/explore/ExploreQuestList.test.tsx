import { render, screen, waitFor } from '@testing-library/react'
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
  it('renders title-only rows without clue, area name or thumbnail', () => {
    render(<ExploreQuestList areas={areas} quests={quests} onOpenQuest={() => {}} />)
    expect(screen.getByRole('region', { name: '選べる謎の一覧' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'この範囲の謎' })).not.toBeInTheDocument()
    expect(screen.getByText('2件')).toBeVisible()
    expect(screen.getByText('港の時計台')).toBeVisible()
    // 行はタイトルだけ（D-46）。地域名・本文の抜粋・サムネイルは行に出さず、詳細側で出す。
    expect(screen.queryByText('横浜')).not.toBeInTheDocument()
    expect(screen.queryByText('大きな時計が見える場所')).not.toBeInTheDocument()
    expect(screen.queryByText('ピンは地域の代表点です。問題の場所そのものではありません。')).not.toBeInTheDocument()
    const card = screen.getByRole('button', { name: '港の時計台の詳細を見る' }).closest('.explore-quest-card')
    expect(card?.querySelector('img')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '博多の灯台の詳細を見る' }).querySelector('img')).not.toBeInTheDocument()
  })

  it('opens the detail under the selected row as an accordion and toggles it from the row', async () => {
    const user = userEvent.setup()
    const onOpenQuest = vi.fn()
    const detail = <div><h3>港の時計台の詳細</h3></div>
    render(<ExploreQuestList areas={areas} quests={quests} selectedQuestId="q1" onOpenQuest={onOpenQuest} detailContent={detail} />)
    const row = screen.getByRole('button', { name: '港の時計台の詳細を見る' })
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '博多の灯台の詳細を見る' })).toHaveAttribute('aria-expanded', 'false')
    // 詳細は選択中の行の直下（同じ li の中）にだけ出る。
    const detailElement = screen.getByRole('heading', { name: '港の時計台の詳細' })
    expect(row.closest('li')).toContainElement(detailElement)
    expect(screen.getByRole('button', { name: '博多の灯台の詳細を見る' }).closest('li')).not.toContainElement(detailElement)
    // 選択中の行をもう一度押すと、選択は変えずに閉じる（onOpenQuest は呼ばない）。
    // 閉じる間は高さアニメーションのため内容が残り、終わると外れる（D-59）。
    await user.click(row)
    expect(onOpenQuest).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('heading', { name: '港の時計台の詳細' })).not.toBeInTheDocument())
    expect(row).toHaveAttribute('aria-expanded', 'false')
    // もう一度押すと開き直す。
    await user.click(row)
    expect(onOpenQuest).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: '港の時計台の詳細' })).toBeVisible()
    // 別の行は従来どおり選択として伝える。
    await user.click(screen.getByRole('button', { name: '博多の灯台の詳細を見る' }))
    expect(onOpenQuest).toHaveBeenCalledWith('q2')
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
    // 選択中地域のサマリバー（地域名＋問数＋閉じる）は出さない（D-45）。
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

  it('読み込み中は「0件」も空メッセージも出さず、行の場所を確保する（D-54）', () => {
    const { container } = render(<ExploreQuestList areas={areas} quests={[]} loading />)
    expect(screen.getByText('読み込み中')).toBeVisible()
    expect(screen.queryByText('0件')).not.toBeInTheDocument()
    expect(screen.queryByText(/選択中の条件に合う謎はありません/)).not.toBeInTheDocument()
    expect(container.querySelectorAll('.explore-quest-skeleton')).toHaveLength(5)
  })

  it('読み込み完了後に0件なら空メッセージを出す（D-54）', () => {
    render(<ExploreQuestList areas={areas} quests={[]} />)
    expect(screen.getByText('0件')).toBeVisible()
    expect(screen.getByText(/選択中の条件に合う謎はありません/)).toBeVisible()
  })

  it('選択中の行の再タップは、解除の受け口があれば選択解除を呼ぶ（D-55）', async () => {
    const user = userEvent.setup()
    const onOpenQuest = vi.fn()
    const onDeselectQuest = vi.fn()
    render(<ExploreQuestList areas={areas} quests={quests} selectedQuestId="q1"
      detailContent={<div>詳細コンテンツ</div>} onOpenQuest={onOpenQuest} onDeselectQuest={onDeselectQuest} />)
    expect(screen.getByText('詳細コンテンツ')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '港の時計台の詳細を見る' }))
    expect(onDeselectQuest).toHaveBeenCalledTimes(1)
    expect(onOpenQuest).not.toHaveBeenCalled()
  })

  it('開閉の枠は全行に常時マウントされ、選択では開状態のクラスだけが切り替わる（D-59追記）', async () => {
    const detail = <div><h3>港の時計台の詳細</h3></div>
    const { container, rerender } = render(<ExploreQuestList areas={areas} quests={quests} onOpenQuest={() => {}} detailContent={detail} />)
    // 未選択でも全行に枠があり、開いている行は無い。枠が常駐していることで、
    // 閉じた高さ（0fr）が確定した状態からクラス切り替えで遷移が始められる。
    const wraps = container.querySelectorAll('.explore-quest-detail-wrap')
    expect(wraps).toHaveLength(quests.length)
    expect(container.querySelector('.explore-quest-detail-wrap.is-open')).not.toBeInTheDocument()
    const firstWrap = wraps[0]
    // 選択されると、枠の要素自体は差し替わらず、対象の行の枠に is-open が付くだけ。
    rerender(<ExploreQuestList areas={areas} quests={quests} selectedQuestId="q1" onOpenQuest={() => {}} detailContent={detail} />)
    expect(container.querySelectorAll('.explore-quest-detail-wrap')[0]).toBe(firstWrap)
    expect(firstWrap).toHaveClass('is-open')
    expect(container.querySelectorAll('.explore-quest-detail-wrap')[1]).not.toHaveClass('is-open')
    expect(firstWrap.querySelector('h3')).not.toBeNull()
    // 選択を外すと is-open が外れ、閉じ終わるまで内容は枠の中に残ってから外れる。
    rerender(<ExploreQuestList areas={areas} quests={quests} selectedQuestId="" onOpenQuest={() => {}} detailContent={detail} />)
    expect(firstWrap).not.toHaveClass('is-open')
    expect(firstWrap.querySelector('h3')).not.toBeNull()
    await waitFor(() => expect(firstWrap.querySelector('h3')).toBeNull())
  })

  it('選択中の行の再タップは、解除の受け口が無ければアコーディオンを閉じるだけにする', async () => {
    const user = userEvent.setup()
    const onOpenQuest = vi.fn()
    render(<ExploreQuestList areas={areas} quests={quests} selectedQuestId="q1"
      detailContent={<div>詳細コンテンツ</div>} onOpenQuest={onOpenQuest} />)
    expect(screen.getByText('詳細コンテンツ')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '港の時計台の詳細を見る' }))
    // 閉じるアニメーション（D-59）が終わると内容は外れる。
    await waitFor(() => expect(screen.queryByText('詳細コンテンツ')).not.toBeInTheDocument())
    expect(onOpenQuest).not.toHaveBeenCalled()
  })
})
