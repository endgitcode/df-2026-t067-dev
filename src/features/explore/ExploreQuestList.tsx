import { useEffect, useRef } from 'react'
import type { PublicArea, PublicQuest } from '../../shared/api/types'
import { questThumbnail } from './viewportQuests'

// 選択状態に連動する謎カードのリスト。並ぶのは呼び出し側が選択（地域・地方の絞り込み）で
// 絞った問題だけであり、地図の表示範囲では変わらない（D-45）。地図が使えない場合も同じ。
export function ExploreQuestList({ areas, quests, highlightArea, selectedQuestId = '', clearedQuestIds, onOpenQuest }: {
  areas: PublicArea[]
  quests: PublicQuest[]
  highlightArea?: PublicArea
  selectedQuestId?: string
  clearedQuestIds?: ReadonlySet<string>
  onOpenQuest?: (questId: string) => void
}) {
  const listRef = useRef<HTMLUListElement>(null)
  const areaLabel = (areaId: string) => areas.find((area) => area.areaId === areaId)?.label ?? ''
  // ピンで選ばれた地域の問題は先頭に寄せ、シートを開いた時にスクロールなしで先頭に出るようにする。
  const orderedQuests = highlightArea
    ? [...quests.filter((quest) => quest.areaId === highlightArea.areaId), ...quests.filter((quest) => quest.areaId !== highlightArea.areaId)]
    : quests

  useEffect(() => {
    if (!highlightArea || !listRef.current) return
    for (const item of listRef.current.querySelectorAll('[data-area-id]')) {
      if (item.getAttribute('data-area-id') !== highlightArea.areaId) continue
      try { (item as HTMLElement).scrollIntoView({ block: 'nearest' }) } catch { /* スクロール位置の補助であり、失敗しても一覧は使える。 */ }
      break
    }
  }, [highlightArea])

  return (
    <section className="explore-list" aria-label="選べる謎の一覧">
      <div className="explore-list-head">
        <span>{quests.length}件</span>
      </div>
      {quests.length === 0
        ? <p className="explore-list-empty">選択中の条件に合う謎はありません。地方・都道府県の条件を変えると、別の謎が表示されます。</p>
        : <ul ref={listRef} className="explore-quest-list">
          {orderedQuests.map((quest) => {
            const thumbnail = questThumbnail(quest)
            const cleared = clearedQuestIds?.has(quest.questId) ?? false
            const content = <>
              {thumbnail && <img src={thumbnail} alt="" />}
              <span className="explore-quest-main">
                <span className="explore-quest-title">{quest.title}</span>
                <span className="explore-quest-area">{areaLabel(quest.areaId)}{quest.questNumber && <span className="explore-quest-number">No. {quest.questNumber}</span>}</span>
                <span className="explore-quest-clue">{quest.clue}</span>
              </span>
              {cleared && <span className="explore-quest-cleared">クリア済み</span>}
            </>
            return <li key={quest.questId} data-area-id={quest.areaId} className={highlightArea?.areaId === quest.areaId ? 'is-highlighted' : undefined}>
              {onOpenQuest
                ? <button type="button" className={'explore-quest-card' + (quest.questId === selectedQuestId ? ' is-selected' : '')}
                  aria-pressed={selectedQuestId ? quest.questId === selectedQuestId : undefined}
                  aria-label={`${quest.title}の詳細を見る`} onClick={() => onOpenQuest(quest.questId)}>{content}</button>
                : <div className="explore-quest-card">{content}</div>}
            </li>
          })}
        </ul>}
    </section>
  )
}
