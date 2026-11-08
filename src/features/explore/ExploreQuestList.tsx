import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { PublicArea, PublicQuest } from '../../shared/api/types'

// 選択状態に連動する謎リスト。並ぶのは呼び出し側が選択（地域・地方の絞り込み）で
// 絞った問題だけであり、地図の表示範囲では変わらない（D-45）。地図が使えない場合も同じ。
// 行はタイトルだけの簡素な形にし、選んだ行の直下に詳細（QuestDetails）を開く
// アコーディオンにする（D-46）。詳細を別枠で下に置くと、タイトルが一覧と詳細で
// 二重に出てパネル／シートが煩雑になるため。
export function ExploreQuestList({ quests, highlightArea, selectedQuestId = '', clearedQuestIds, onOpenQuest, onDeselectQuest, scrollToHighlight = true, detailContent, detailRef, loading = false }: {
  areas: PublicArea[]
  quests: PublicQuest[]
  highlightArea?: PublicArea
  selectedQuestId?: string
  clearedQuestIds?: ReadonlySet<string>
  onOpenQuest?: (questId: string) => void
  /** 選択中の行をもう一度押した時の選択解除（D-55）。ピンの再タップ（D-44）と
      揃え、行・カードでも再タップで選択を外せるようにする。 */
  onDeselectQuest?: () => void
  /** 読み込み中は件数と「謎はありません」を出さず、行の場所だけを確保する。
      一瞬だけ「0件／空です」が見えるチラつきと、読み込み前後の大きさの変化を防ぐ。 */
  loading?: boolean
  /** ハイライトされた地域の先頭カードへリスト内スクロールするか。地図下の一覧（#70）では
      ページ側のスクロールと競合するため切る。 */
  scrollToHighlight?: boolean
  /** 選択中の問題の詳細。選択中の行の直下にだけ差し込む（同時に開くのは1つだけ）。 */
  detailContent?: ReactNode
  /** 詳細のラッパへの ref。呼び出し側が「問題を見る」の着地（#70）に使う。 */
  detailRef?: RefObject<HTMLDivElement | null>
}) {
  const listRef = useRef<HTMLUListElement>(null)
  // アコーディオンを閉じた問題。選択解除の受け口が無い使われ方でのみ使い、
  // 選択自体は変えず、詳細の表示だけを畳む（受け口がある場合は再タップ＝選択解除）。
  const [closedQuestId, setClosedQuestId] = useState('')
  // ピンで選ばれた地域の問題は先頭に寄せ、シートを開いた時にスクロールなしで先頭に出るようにする。
  const orderedQuests = highlightArea
    ? [...quests.filter((quest) => quest.areaId === highlightArea.areaId), ...quests.filter((quest) => quest.areaId !== highlightArea.areaId)]
    : quests
  const expandedQuestId = detailContent && selectedQuestId && closedQuestId !== selectedQuestId ? selectedQuestId : ''

  useEffect(() => {
    if (!scrollToHighlight || !highlightArea || !listRef.current) return
    for (const item of listRef.current.querySelectorAll('[data-area-id]')) {
      if (item.getAttribute('data-area-id') !== highlightArea.areaId) continue
      try { (item as HTMLElement).scrollIntoView({ block: 'nearest' }) } catch { /* スクロール位置の補助であり、失敗しても一覧は使える。 */ }
      break
    }
  }, [highlightArea, scrollToHighlight])

  const handleRowClick = (questId: string) => {
    if (questId === selectedQuestId) {
      // 選択中の行の再タップは選択解除に統一する（D-55、ピンの再タップ D-44 と同じ）。
      // 解除すると詳細も閉じ、地図は未選択の表示へ戻る。解除の受け口が無い使われ方
      // では、従来どおりアコーディオンの開閉だけを行う。
      if (onDeselectQuest) {
        setClosedQuestId('')
        onDeselectQuest()
        return
      }
      if (detailContent) {
        setClosedQuestId((current) => (current === questId ? '' : questId))
        return
      }
    }
    onOpenQuest?.(questId)
  }

  return (
    <section className="explore-list" aria-label="選べる謎の一覧">
      <div className="explore-list-head">
        <span>{loading ? '読み込み中' : `${quests.length}件`}</span>
      </div>
      {quests.length === 0 && loading
        ? <ul className="explore-quest-list" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((index) => <li key={index}><div className="explore-quest-card explore-quest-skeleton" /></li>)}
        </ul>
        : quests.length === 0
        ? <p className="explore-list-empty">選択中の条件に合う謎はありません。地方・都道府県の条件を変えると、別の謎が表示されます。</p>
        : <ul ref={listRef} className="explore-quest-list">
          {orderedQuests.map((quest) => {
            const cleared = clearedQuestIds?.has(quest.questId) ?? false
            const expanded = quest.questId === expandedQuestId
            const content = <>
              <span className="explore-quest-title">{quest.title}</span>
              {quest.questNumber && <span className="explore-quest-number">No. {quest.questNumber}</span>}
              {cleared && <span className="explore-quest-cleared">クリア済み</span>}
            </>
            return <li key={quest.questId} data-area-id={quest.areaId} className={highlightArea?.areaId === quest.areaId ? 'is-highlighted' : undefined}>
              {onOpenQuest
                ? <button type="button" className={'explore-quest-card' + (quest.questId === selectedQuestId ? ' is-selected' : '')}
                  {...(detailContent
                    ? { 'aria-expanded': expanded }
                    : { 'aria-pressed': selectedQuestId ? quest.questId === selectedQuestId : undefined })}
                  aria-label={`${quest.title}の詳細を見る`} onClick={() => handleRowClick(quest.questId)}>{content}</button>
                : <div className="explore-quest-card">{content}</div>}
              {expanded && detailContent && <div ref={detailRef} className="explore-quest-detail">{detailContent}</div>}
            </li>
          })}
        </ul>}
    </section>
  )
}
