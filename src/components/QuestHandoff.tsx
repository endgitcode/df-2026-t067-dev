import { useState } from 'react'
import { QuestQrCode } from './QuestQrCode'

export function QuestHandoff({ value = window.location.href, title = 'この問題' }: { value?: string; title?: string }) {
  const [visible, setVisible] = useState(true)
  return <div className="quest-handoff">
    <button type="button" className="primary-button" aria-expanded={visible} onClick={() => setVisible(current => !current)}>スマホで挑戦する</button>
    {visible && <div className="quest-handoff-panel">
      <QuestQrCode value={value} label={`${title}をスマートフォンで開くQRコード`} />
      <p className="handoff-caption">スマホで読み取って挑戦しよう</p>
    </div>}
  </div>
}
