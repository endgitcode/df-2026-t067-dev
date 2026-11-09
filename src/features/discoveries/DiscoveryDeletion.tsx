import { useRef, useState } from 'react'
import type { ApiClient } from '../../shared/api'
import { useRequestAction } from '../../shared/useRequestAction'

export type State = 'idle' | 'confirm' | 'working' | 'pending' | 'send-error' | 'check-error' | 'failed'

export function DiscoveryDeletion({ api, id, onDeleted, onStateChange, initialReceipt, initialState, onReceipt }: {
  initialReceipt?: string; initialState?: State; onReceipt?: (receipt: string) => void
  api: ApiClient; id: string; onDeleted: () => void; onStateChange: (state: State) => void
}) {
  const [state, setState] = useState<State>(initialState === 'working' ? (initialReceipt ? 'pending' : 'send-error') : initialState ?? 'idle')
  const receipt = useRef<string | null>(initialReceipt ?? null)
  const begin = useRequestAction()

  function updateState(next: State) {
    setState(next)
    onStateChange(next)
  }

  async function check() {
    const operation = begin(() => updateState(receipt.current ? 'check-error' : 'send-error'))
    if (!operation) return
    updateState('working')
    try {
      const call = { signal: operation.signal }
      if (receipt.current === null) {
        const result = await api.deleteDiscovery(id, call)
        if (!operation.isCurrent()) return
        receipt.current = result.deletionId
        onReceipt?.(result.deletionId)
      }
      const result = await api.getDeletion(receipt.current, call)
      if (!operation.isCurrent()) return
      if (result.state === 'completed') onDeleted()
      else if (result.state === 'pending') updateState('pending')
      else updateState(result.retryable ? 'check-error' : 'failed')
    } catch {
      if (operation.isCurrent()) updateState(receipt.current ? 'check-error' : 'send-error')
    } finally { operation.finish() }
  }

  if (state === 'idle') return <button type="button" className="secondary-button record-delete" onClick={() => setState('confirm')}>記録を削除</button>
  return <div className="record-deletion" role="group" aria-label="本人記録の削除">
    {state === 'confirm' && <>
      <p>この記録と写真を削除しますか？</p>
      <div className="camera-actions">
        <button type="button" className="secondary-button" onClick={() => setState('idle')}>キャンセル</button>
        <button type="button" className="danger-button" onClick={check}>記録と写真を削除する</button>
      </div>
    </>}
    {state === 'working' && <p role="status">削除状態を確認しています…</p>}
    {state === 'pending' && <>
      <p role="status">削除を受け付けました。</p>
      <button type="button" className="secondary-button" onClick={check}>削除状態を確認</button>
    </>}
    {(state === 'send-error' || state === 'check-error') && <>
      <p role="alert">削除が完了したか確認できません。再確認してください。</p>
      <button type="button" className="secondary-button" onClick={check}>{state === 'check-error' ? '削除状態を再確認' : '削除を再試行'}</button>
    </>}
    {state === 'failed' && <p role="alert">削除は完了していません。記録を読み直してください。</p>}
  </div>
}
