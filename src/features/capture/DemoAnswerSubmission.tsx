import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { ApiError } from '../../shared/api'
import { ClearCelebration } from './ClearCelebration'
import { ClearScreen } from './ClearScreen'
import type { ApiClient, AttemptOutcome, AttemptResult, CaptureMetadata, LocalApiDataMode } from '../../shared/api'

export interface DemoAnswerContext {
  api: Pick<ApiClient, 'submitAnswer' | 'getAttempt'>
  challengeId: string
  onReloadQuest: () => void
  onOpenDiscovery?: (id: string) => void
  // クリア画面の「地図に戻る」用。撮影を終えて探索画面へ戻す操作を呼び出し側が渡す。
  // クリア済みの記録ID（あれば）を一緒に渡し、呼び出し側が詳細側のクリア済み
  // 表示へ即時反映できるようにする（D-64）。
  onReturnToMap?: (discoveryId?: string) => void
  // クリア画面に出す問題タイトル。
  questTitle?: string
  dataMode?: LocalApiDataMode
}

type ReceiptView = { attemptId: string; message: string; canCheck: boolean; reload?: boolean; discoveryId?: string; cleared?: boolean }
type Failure = { message: string; reload?: true; retake?: true; retryAfterSeconds?: number }
type Operation = { controller: AbortController; deadline?: ReturnType<typeof setTimeout> }

const durableMessages: Record<AttemptOutcome, string> = {
  CORRECT: 'テストでクリアしました。「自分の記録」で確認できます。',
  ALREADY_CLEARED: 'クリア済みです。「自分の記録」に初回の写真が残っています。',
  OUTSIDE_AREA: 'テスト用の撮影範囲外です。テストの位置設定を確認してください。',
  LOCATION_UNCERTAIN: '位置を確認できませんでした。テストの位置設定と精度を確認してください。',
  WRONG_TARGET: '写真の対象が一致しませんでした。合成画像を確認してください。',
  IMAGE_UNCERTAIN: '写真の対象を確認できませんでした。合成画像を確認してください。',
  QUEST_UNAVAILABLE: 'この問題の受付は終了しました。問題を読み直してください。',
  QUEST_CHANGED: '問題が更新されました。最新版を読み直してください。',
  SYSTEM_ERROR: '回答を処理できませんでした。時間をおいて試し直してください。',
}

const trialMessages: Record<AttemptOutcome, string> = {
  CORRECT: 'クリアしました。「自分の記録」で確認できます。',
  ALREADY_CLEARED: 'クリア済みです。「自分の記録」に初回の写真が残っています。',
  OUTSIDE_AREA: '指定の撮影範囲外です。範囲内で撮り直してください。',
  LOCATION_UNCERTAIN: '位置を確認できませんでした。撮影場所を確認して撮り直してください。',
  WRONG_TARGET: '写真の対象が一致しませんでした。対象を確認して撮り直してください。',
  IMAGE_UNCERTAIN: '写真の対象を確認できませんでした。写真を撮り直してください。',
  QUEST_UNAVAILABLE: 'この問題の受付は終了しました。問題を読み直してください。',
  QUEST_CHANGED: '問題が更新されました。最新版を読み直してください。',
  SYSTEM_ERROR: '回答を処理できませんでした。時間をおいて試し直してください。',
}

function receiptView(result: AttemptResult, dataMode: LocalApiDataMode | undefined, expectedId?: string): ReceiptView {
  const real = dataMode === 'durable-local' || dataMode === 'team-preview'
  if (result.source !== (real ? 'real' : 'mock') || (expectedId !== undefined && result.attemptId !== expectedId)) {
    throw new ApiError('INVALID_RESPONSE')
  }
  const attemptId = result.attemptId
  if (real) {
    if (result.state !== 'COMPLETED') {
      return { attemptId, canCheck: true, message: '回答を受け付けました。判定結果を確認できます。' }
    }
    const messages = dataMode === 'durable-local' ? durableMessages : trialMessages
    return { attemptId, canCheck: false, message: messages[result.outcome],
      discoveryId: result.outcome === 'CORRECT' || result.outcome === 'ALREADY_CLEARED' ? result.optionalDiscoveryId : undefined,
      // 演出は初回クリアの確定時だけ（D-42）。クリア済み・その他の結果では出さない。
      cleared: result.outcome === 'CORRECT',
      reload: result.outcome === 'QUEST_CHANGED' || result.outcome === 'QUEST_UNAVAILABLE' }
  }
  if (result.state === 'RECEIVED') {
    return { attemptId, canCheck: true, message: 'デモ受付済みです。写真判定と記録保存は未接続です。' }
  }
  if (result.outcome === 'OUTSIDE_AREA') {
    return { attemptId, canCheck: false, message: '指定の撮影範囲外です（開発用の位置判定）。範囲内で撮り直してください。' }
  }
  if (result.outcome === 'LOCATION_UNCERTAIN') {
    return { attemptId, canCheck: false, message: '位置を確認できませんでした（開発用の位置判定）。撮影場所を確認して撮り直してください。' }
  }
  throw new ApiError('INVALID_RESPONSE')
}

function answerFailure(cause: unknown): Failure {
  const error = cause instanceof ApiError ? cause : new ApiError('SYSTEM_ERROR')
  switch (error.code) {
    case 'QUEST_CHANGED': return { message: '問題が更新されました。最新版を読み直してください。', reload: true }
    case 'QUEST_UNAVAILABLE':
    case 'NOT_FOUND': return { message: 'この問題の受付は終了しました。問題を読み直してください。', reload: true }
    case 'NETWORK_ERROR': return { message: '通信状況を確認してください。受付済みか確認できませんでした。' }
    case 'UNAUTHENTICATED': return { message: 'ログインを確認できませんでした。再度ログインしてください。' }
    case 'RATE_LIMITED': return { message: '操作が多いため、時間をおいて再試行してください。', retryAfterSeconds: error.retryAfterSeconds ?? 60 }
    case 'MEDIA_TOO_LARGE': return { message: '写真の容量が上限を超えました。撮り直してください。', retake: true }
    case 'INVALID_INPUT':
    case 'IDEMPOTENCY_CONFLICT': return { message: '写真と位置を確認できませんでした。撮り直してください。', retake: true }
    default: return { message: '回答の受付を確認できませんでした。時間をおいて再試行してください。' }
  }
}

export function DemoAnswerSubmission({ context, photo, metadata, disabled, onSubmissionStarted, onSubmissionResolved }: {
  context: DemoAnswerContext
  photo: Blob
  metadata: CaptureMetadata
  disabled: boolean
  onSubmissionStarted: () => void
  onSubmissionResolved?: () => void
}) {
  const onOpenDiscovery = context.onOpenDiscovery
  const dataMode = context.dataMode
  const real = dataMode === 'durable-local' || dataMode === 'team-preview'
  const [receipt, setReceipt] = useState<ReceiptView | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [pending, setPending] = useState(false)
  const active = useRef<Operation | null>(null)
  const automaticReads = useRef(0)
  const automaticStopped = useRef(false)
  const [pollLimit, setPollLimit] = useState(false)
  const idempotencyKey = useRef<string | null>(null)
  const abort = useCallback(() => {
    const operation = active.current
    active.current = null
    if (operation) { clearTimeout(operation.deadline); operation.controller.abort() }
  }, [])
  useEffect(() => abort, [abort])
  const openedDiscovery = useRef<string | null>(null)
  useEffect(() => {
    if (!receipt?.discoveryId || !onOpenDiscovery || openedDiscovery.current === receipt.discoveryId) return
    // 初回クリアはクリア画面（D-63）を挟むため自動では開かず、「自分の記録を見る」
    // ボタンからの遷移だけにする。クリア済み（ALREADY_CLEARED）は従来どおり自動で開く。
    if (receipt.cleared) return
    openedDiscovery.current = receipt.discoveryId
    onOpenDiscovery(receipt.discoveryId)
  }, [receipt, onOpenDiscovery])
  const [clearScreenClosed, setClearScreenClosed] = useState(false)
  const showClearScreen = Boolean(receipt?.cleared && !clearScreenClosed)
  function viewRecord() {
    if (!receipt?.discoveryId || !onOpenDiscovery) { setClearScreenClosed(true); return }
    openedDiscovery.current = receipt.discoveryId
    onOpenDiscovery(receipt.discoveryId)
  }
  function returnToMap() {
    setClearScreenClosed(true)
    context.onReturnToMap?.(receipt?.discoveryId)
  }

  useEffect(() => {
    if (!failure?.retryAfterSeconds) return
    const timer = setTimeout(() => {
      setFailure((current) => current === failure ? (real && receipt?.canCheck ? null : { message: failure.message }) : current)
    }, failure.retryAfterSeconds * 1000)
    return () => clearTimeout(timer)
  }, [failure, real, receipt])

  const cancel = useCallback((message: string) => {
    automaticStopped.current = true
    abort()
    setPending(false)
    setFailure({ message })
  }, [abort])

  const poll = useEffectEvent(() => { void exchange(true) })
  useEffect(() => {
    if (!real || !receipt?.canCheck || pending || failure || automaticStopped.current) return
    if (automaticReads.current >= 6) { setPollLimit(true); return }
    const timer = setTimeout(() => {
      automaticReads.current += 1
      poll()
    }, Math.min(1000 * 2 ** automaticReads.current, 8000))
    return () => clearTimeout(timer)
  }, [real, receipt, pending, failure])

  useEffect(() => {
    const leave = () => cancel(receipt ? '受付状態の確認を中止しました。同じ受付IDで再確認できます。' : '送信を中止しました。受付済みか確認できませんでした。')
    window.addEventListener('pagehide', leave)
    return () => window.removeEventListener('pagehide', leave)
  }, [cancel, receipt])

  async function exchange(automatic = false) {
    if (active.current || failure?.reload || failure?.retake || failure?.retryAfterSeconds || (receipt && !receipt.canCheck)) return
    if (!automatic) { automaticReads.current = 0; automaticStopped.current = false; setPollLimit(false) }
    const operation: Operation = { controller: new AbortController() }
    active.current = operation
    if (!receipt) onSubmissionStarted()
    setPending(true)
    setFailure(null)
    operation.deadline = setTimeout(() => {
      if (active.current === operation) cancel('受付の確認に時間がかかっています。通信状況を確認してください。')
    }, 10_000)
    try {
      const call = { signal: operation.controller.signal }
      const response = receipt ? await context.api.getAttempt(receipt.attemptId, call)
        : await context.api.submitAnswer({ challengeId: context.challengeId, photo, metadata,
          idempotencyKey: idempotencyKey.current ??= crypto.randomUUID() }, call)
      if (active.current !== operation) return
      const nextReceipt = receiptView(response, dataMode, receipt?.attemptId)
      setReceipt(nextReceipt)
      if (!nextReceipt.canCheck) onSubmissionResolved?.()
    } catch (cause) {
      if (active.current !== operation) return
      const next = answerFailure(cause)
      if (next.reload) setReceipt(null)
      setFailure(next)
      // 受付結果が不明な通信失敗・取消では写真と冪等キーを保持する。
      if (!receipt && next.retake) onSubmissionResolved?.()
    } finally {
      clearTimeout(operation.deadline)
      if (active.current === operation) { active.current = null; setPending(false) }
    }
  }

  return <div className="camera-actions" aria-label="開発用の回答受付">
    {showClearScreen && <ClearScreen questTitle={context.questTitle} photo={photo}
      onViewRecord={viewRecord} onReturnToMap={returnToMap} />}
    {receipt?.cleared && !showClearScreen && <ClearCelebration />}
    {receipt && <p role="status">{receipt.message}</p>}
    {failure && <p role="alert">{failure.message}</p>}
    {pollLimit && <p role="status">自動確認をいったん終了しました。処理の失敗ではありません。同じ受付IDで再確認できます。</p>}
    {(failure?.reload || receipt?.reload) && <button type="button" className="retry-button" onClick={context.onReloadQuest}>問題を読み直す</button>}
    {!failure?.reload && !failure?.retake && (!receipt || receipt.canCheck) &&
      <button type="button" className="primary-button" disabled={disabled || pending || !!failure?.retryAfterSeconds} onClick={() => void exchange()}>
        {pending ? '受付を確認しています…' : receipt ? (real ? '判定結果を確認' : '受付状態を確認')
          : failure ? '同じ回答を再送' : dataMode === 'durable-local' ? '写真と位置をテスト送信'
            : dataMode === 'team-preview' ? '写真と位置を送信' : '写真と位置をデモ送信'}
      </button>}
    {pending && <button type="button" className="secondary-button" onClick={() => cancel(receipt
      ? '受付状態の確認を中止しました。' : '送信を中止しました。受付済みか確認できませんでした。')}>受付の確認をキャンセル</button>}
  </div>
}
