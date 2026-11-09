import { QuestQrCode } from './QuestQrCode'

export function QuestHandoff({ value = window.location.href, title = 'この問題' }: { value?: string; title?: string }) {
  return <div className="quest-handoff">
    {<div className="quest-handoff-panel">
      <QuestQrCode value={value} label={`${title}をスマートフォンで開くQRコード`} />
      <p className="handoff-caption">スマホで読み取って挑戦しよう</p>
    </div>}
  </div>
}
