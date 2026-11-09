import { useEffect, useRef, useState } from 'react'
import { ClearCelebration } from './ClearCelebration'

// 初回クリア確定（CORRECT）のときだけ、アプリ全体を覆って出すクリア画面（D-63）。
// パネル内の一文＋小さな演出では達成感が伝わらないため、バッジを主役に据え、
// 自分が送信した写真と問題タイトル・クリア日を見せる。遷移はボタンのみで、
// 記録詳細への自動遷移はしない（呼び出し側がボタンのハンドラを渡す）。
export function ClearScreen({ questTitle, photo, onViewRecord, onReturnToMap }: {
  questTitle?: string
  photo: Blob
  onViewRecord?: () => void
  onReturnToMap?: () => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  // 送信した写真の表示用 URL はマウント時に1回だけ作り、アンマウントで破棄する。
  const [photoUrl] = useState<string | null>(() => {
    try { return URL.createObjectURL(photo) } catch { return null }
  })
  // クリア日はこの画面が初めて出た日（＝クリア確定を確認した日）で固定する。
  const [clearedDate] = useState(() => new Date())
  useEffect(() => {
    if (!photoUrl) return
    return () => URL.revokeObjectURL(photoUrl)
  }, [photoUrl])
  useEffect(() => { headingRef.current?.focus() }, [])
  const dateLabel = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(clearedDate)
  return (
    <div className="clear-screen" role="dialog" aria-modal="true" aria-labelledby="clear-screen-title">
      <div className="clear-screen-card">
        <ClearCelebration large />
        <h2 id="clear-screen-title" className="clear-screen-title" ref={headingRef} tabIndex={-1}>クリア！</h2>
        {questTitle && <p className="clear-screen-quest">{questTitle}</p>}
        {photoUrl && <img className="clear-screen-photo" src={photoUrl} alt="送信した写真" />}
        <p className="clear-screen-date">クリア日：{dateLabel}</p>
        <div className="clear-screen-actions">
          {onViewRecord && <button type="button" className="primary-button" onClick={onViewRecord}>自分の記録を見る</button>}
          {onReturnToMap && <button type="button" className="secondary-button" onClick={onReturnToMap}>地図に戻る</button>}
        </div>
      </div>
    </div>
  )
}
