import { useEffect, useRef } from 'react'
import type { PublicArea, PublicQuest } from '../../shared/api/types'
import { questThumbnail } from './viewportQuests'

// 地図の表示範囲と連動する謎カードのリスト。地図が使えない場合は全地域分をそのまま並べる。
export function ExploreQuestList({ areas, quests, variant, highlightArea, selectedQuestId = '', clearedQuestIds, onOpenQuest, onClearHighlight, emptyText }: {
  areas: PublicArea[]
  quests: PublicQuest[]
  variant: 'viewport' | 'fallback'
  highlightArea?: PublicArea
  selectedQuestId?: string
  clearedQuestIds?: ReadonlySet<string>
  onOpenQuest?: (questId: string) => void
  onClearHighlight?: () => void
  /** 空表示の文言。絞り込みの結果が全体で0件の場合など、範囲外が理由でない時に呼び出し側が差し替える。 */
  emptyText?: string
}) {
  const listRef = useRef<HTMLUListElement>(null)
  const areaLabel = (areaId: string) => areas.find((area) => area.areaId === areaId)?.label ?? ''
  const highlightCount = highlightArea ? quests.filter((quest) => quest.areaId === highlightArea.areaId).length : 0
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
    <section className="explore-list" aria-label={variant === 'viewport' ? '表示範囲の謎' : '選べる謎の一覧'}>
      <div className="explore-list-head">
        <span>{quests.length}件</span>
      </div>
      {highlightArea && <div className="explore-list-focus">
        <strong>{highlightArea.label}</strong><span>{highlightCount}問</span>
        <button type="button" onClick={onClearHighlight}>閉じる</button>
      </div>}
      {quests.length === 0
        ? <p className="explore-list-empty">{emptyText ?? 'この範囲に謎はありません。地図を移動すると、別の地域の謎が表示されます。'}</p>
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
