import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, parsePublishManagedQuest } from '../../shared/api'
import type { ApiClient, ManagedQuest, PhotoDecision, PublishManagedQuest, ReviewField, ReviewSubmission } from '../../shared/api'
import { PhotoRightsInput } from './PhotoRightsInput'
import { fixturePngUrl, matchFixturePngBase64, otherFixturePngBase64 } from './photoTestFixtures'
import { useRequestAction } from '../../shared/useRequestAction'

import { reviewLabels } from './publicationReadiness'

type Confirmation = keyof NonNullable<PublishManagedQuest['confirmations']>
const confirmationLabels: ReadonlyArray<readonly [Confirmation, string]> = [
  ['fictionalData', '素材と情報の内容を確認した'],
  ['visitConditions', '訪問条件と撮影時の注意を確認した'],
  ['photoRights', '写真の権利と公開する画像を確認した'],
  ['shootingArea', '撮影できる範囲（非公開）を確認した'],
  ['testCases', '一致と別対象の試験を確認した'],
]
type Failure = { message: string; stale?: true }
type TrialKind = 'MATCH' | 'WRONG_TARGET'
type TestProofs = Partial<Record<TrialKind, string>>
type TrialFeedback = { kind: 'pending' | 'success' | 'error'; message: string }

function publicationFailure(cause: unknown, realPhotoTest: boolean): Failure {
  const code = cause instanceof ApiError ? cause.code : undefined
  switch (code) {
    case 'DRAFT_CONFLICT': return { message: '下書きの版が変わりました。一覧から最新版を確認してください。', stale: true }
    case 'FORBIDDEN': return { message: '担当組織の操作権限を確認できません。', stale: true }
    case 'PHOTO_APPROVAL_REQUIRED': return { message: '素材の事前承認が必要です。運営に承認を依頼するか、承認済みの写真を選んでください。' }
    case 'NETWORK_ERROR': return { message: '通信に失敗しました。通信状況を確認し、同じ写真で再送してください。' }
    case 'PHOTO_TEST_REQUIRED': return { message: 'この版で異なる写真を使って一致・別対象の試験を確認してください。' }
    case 'REVIEW_REQUIRED': return { message: 'この版の公開条件を確認してください。' }
    case 'INVALID_INPUT': return { message: '試験写真の形式と保存済みの参考写真を確認してください。' }
    case 'RATE_LIMITED': return { message: '試験の受付上限に達しました。時間をおいて再試行してください。' }
    case 'SYSTEM_ERROR': return realPhotoTest
      ? { message: '試験を処理できませんでした。時間をおいて再試行してください。' }
      : { message: '試験を処理できませんでした。この検証環境では合成写真でのみ記録されるため、実写真では結果が残りません。' }
    default: return { message: '結果を確認できませんでした。通信状況を確認して再試行してください。' }
  }
}

function PhotoTrial({ expected, disabled, feedback, onTest, onSelection }:   {
  expected: TrialKind; disabled: boolean; feedback?: TrialFeedback; onSelection: (kind: TrialKind) => void
  onTest: (file: File, key: string, expected: TrialKind) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const key = useRef<string | null>(null)
  const label = expected === 'MATCH' ? '一致写真' : '別対象写真'
  const valid = file && file.size > 0 && file.size <= 4 * 1024 * 1024 && ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
  return <form onSubmit={(event) => {
    event.preventDefault()
    if (valid && !disabled) onTest(file, key.current ??= crypto.randomUUID(), expected)
  }}>
    <fieldset disabled={disabled}>
      <legend>{label}</legend>
      <label>{label}を選択<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
        setFile(event.target.files?.[0] ?? null)
        key.current = null
        onSelection(expected)
      }} /></label>
      {file && !valid && <p>4 MiB以内のJPEG・PNG・WebPを選んでください。</p>}
      <button type="submit" disabled={!valid}>{label}の試験を送信</button>
      <p role={feedback?.kind === 'error' ? 'alert' : 'status'}>{feedback?.message ?? '写真を選んで送信してください。'}</p>
    </fieldset>
  </form>
}

export function PublicationWorkspace({ api, initial, onBack, onPublished, rightsAssist = false, backLabel = '問題一覧へ戻る', photoTestSource = 'mock', areaUnclassified = false, approvedAssets = false, onFix, onBusy, onTrialConfirmed, readiness, readinessFailed, onReadinessRetry }: {
  api: ApiClient; initial: ManagedQuest; rightsAssist?: boolean; backLabel?: string; photoTestSource?: 'mock' | 'real'; areaUnclassified?: boolean; approvedAssets?: boolean; onFix?: (field: ReviewField) => void; onBusy?: (busy: boolean) => void; onTrialConfirmed?: () => void;
  readiness?: ReviewSubmission; readinessFailed?: boolean; onReadinessRetry?: () => void; onBack: () => void; onPublished: () => void
}) {
  const [quest, setQuest] = useState(initial)
  const [photo, setPhoto] = useState<File | null>(null)
  const [rights, setRights] = useState('')
  const [reuseNeeded, setReuseNeeded] = useState(false)
  const previousPhoto = useRef<File | null>(null)
  const key = useRef<string | null>(null)
  const [outcome, setOutcome] = useState<PhotoDecision | null>(null)
  const [proofs, setProofs] = useState<TestProofs>({})
  const [trialFeedback, setTrialFeedback] = useState<Partial<Record<TrialKind, TrialFeedback>>>({})
  const [reviewMissing, setMissing] = useState<ReviewField[]>([])
  const [checked, setChecked] = useState<Confirmation[]>([])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const begin = useRequestAction()
  const { orgId, questId, draftRevision } = quest
  const disabled = busy || !!failure?.stale
  const photoValid = photo !== null && photo.size > 0 && photo.size <= 4 * 1024 * 1024 &&
    ['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)
  const missing = approvedAssets ? readiness?.missing ?? [] : reviewMissing
  const checkReason = areaUnclassified ? '地域の分類が完了するまで公開できません。'
    : approvedAssets && !readiness ? '最新版の公開準備状況を確認してください。'
    : missing.length ? '不足項目を修正してください。'
    : (approvedAssets ? readiness?.quest.status : quest.status) !== 'review_pending' ? 'この版の公開条件を確認してください。'
    : !proofs.MATCH || !proofs.WRONG_TARGET ? 'この下書き版で一致・別対象の写真試験を完了してください。'
    : ''
  const reviewed = !checkReason
  const ready = reviewed && (approvedAssets || confirmationLabels.every(([item]) => checked.includes(item)))
  const realPhotoTest = photoTestSource === 'real'

  async function perform<T>(work: (signal: AbortSignal) => Promise<T>, receive: (value: T) => void,
    report?: (result: TrialFeedback) => void) {
    if (failure?.stale) return
    const operation = begin(() => {
      const message = '通信に時間がかかっています。通信状況を確認し、同じ写真で再送してください。'
      if (report) report({ kind: 'error', message })
      else setFailure({ message })
      setBusy(false)
      onBusy?.(false)
    })
    if (!operation) return
    setBusy(true)
    onBusy?.(true)
    setFailure(null)
    report?.({ kind: 'pending', message: '写真を送信し、結果を確認しています…' })
    try {
      const result = await work(operation.signal)
      if (operation.isCurrent()) receive(result)
    } catch (cause) {
      if (operation.isCurrent()) {
        const failure = publicationFailure(cause, realPhotoTest)
        if (report) report({ kind: 'error', message: failure.message })
        if (!report || failure.stale) setFailure(failure)
        if (cause instanceof ApiError && ['PHOTO_APPROVAL_REQUIRED', 'REVIEW_REQUIRED', 'DRAFT_CONFLICT'].includes(cause.code)) onReadinessRetry?.()
      }
    } finally {
      if (operation.isCurrent()) { setBusy(false); onBusy?.(false) }
      operation.finish()
    }
  }

  function trial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!photoValid || !rights.trim() || reuseNeeded) return
    sendTrial(photo!, key.current ??= crypto.randomUUID())
  }

  function resetTrial(kind: TrialKind) {
    setTrialFeedback((current) => ({ ...current, [kind]: undefined }))
    setProofs((current) => ({ ...current, [kind]: undefined }))
    setChecked([])
  }

  function sendTrial(file: File, idempotencyKey: string, expected?: TrialKind) {
    const report = expected && ((feedback: TrialFeedback) => {
      setTrialFeedback((current) => ({ ...current, [expected]: feedback }))
      if (feedback.kind === 'pending') setProofs((current) => ({ ...current, [expected]: undefined }))
    })
    void perform((signal) => api.testManagedQuest(orgId, questId, {
      expectedDraftRevision: draftRevision, photo: file, ...(approvedAssets ? {} : { photoRights: rights }), idempotencyKey,
    }, { signal }), (result) => {
      if (result.source !== photoTestSource) throw new ApiError('INVALID_RESPONSE')
      setOutcome(result.outcome)
      setChecked([])
      if (expected && result.outcome !== expected) {
        const message = result.outcome === 'IMAGE_UNCERTAIN' ? '判定できませんでした。対象がはっきり写った写真で再試験してください。'
          : '想定した判定と一致しません。対象を確認し、別の写真で再試験してください。'
        report?.({ kind: 'error', message })
        return
      }
      if (result.outcome !== 'IMAGE_UNCERTAIN') {
        setProofs((current) => ({ ...current, [result.outcome]: result.testId }))
        onTrialConfirmed?.()
        report?.({ kind: 'success', message: result.outcome === 'MATCH' ? '一致試験を確認しました。' : '別対象の試験を確認しました。' })
      }
    }, report)
  }

  function review() {
    void perform((signal) => api.submitManagedQuestReview(orgId, questId, draftRevision, { signal }), (result) => {
      setQuest(result.quest)
      setMissing(result.missing)
      setChecked([])
      onReadinessRetry?.()
    })
  }

  function publish() {
    if (!ready || areaUnclassified) return
    void perform((signal) => api.publishManagedQuest(orgId, questId, parsePublishManagedQuest({
      expectedDraftRevision: draftRevision, matchTestId: proofs.MATCH, mismatchTestId: proofs.WRONG_TARGET,
      ...(approvedAssets ? {} : { confirmations: Object.fromEntries(checked.map((item) => [item, true])) }),
    }, approvedAssets), { signal }), onPublished)
  }

  return <section className="form-section" aria-labelledby="publication-workspace-title">
    <h2 id="publication-workspace-title">写真試験と公開確認</h2>
    <p>{quest.draft.content.title || '無題の下書き'}・下書き版 {draftRevision}</p>
    <p>{realPhotoTest ? '検証用の環境です。写真試験は実写真で照合します。' : '検証用の環境です。合成写真を使います。'}</p>
    <button type="button" onClick={onBack}>{backLabel}</button>
    {areaUnclassified && <p role="alert">この地域は都道府県コードが未設定（未分類）のため、公開できません。地域の分類が完了するまで公開は止まります。</p>}
    {failure && <p role="alert">{failure.message}</p>}
    {busy && <p role="status">操作結果を確認しています…</p>}
    <fieldset disabled={disabled}>
      <legend>公開条件の確認</legend>
      {approvedAssets && !readiness && <p role={readinessFailed ? 'alert' : 'status'}>{readinessFailed ? '公開準備状況を取得できませんでした。' : '公開準備状況を確認しています。'}</p>}
      {readinessFailed && <button type="button" onClick={onReadinessRetry}>公開準備状況を読み直す</button>}
      <button type="button" onClick={review} disabled={approvedAssets && (!readiness || missing.length > 0)}>この版の公開条件を確認</button>
      {quest.status === 'review_pending' && <p role="status">{approvedAssets ? 'この版の入力条件を確認しました。' : 'この下書きは確認待ちです。'}</p>}
      {missing.length > 0 && <><p>次の項目を確認してください。</p><ul>{missing.map((item) => <li key={item}>{onFix ? <button type="button" onClick={() => onFix(item)}>{reviewLabels[item]}を確認</button> : reviewLabels[item]}</li>)}</ul></>}
    </fieldset>
    {approvedAssets ? <>
      {realPhotoTest && <p>照合に使う許可がある写真を選んでください。送信ごとに回答と共用の送信枠を1回使います。</p>}
      {!realPhotoTest && <p>参考写真には一致用の合成写真を登録し、試験には次の2枚を使ってください。<br /><a href={fixturePngUrl(matchFixturePngBase64)} download="match.png">一致用の合成写真</a> ・ <a href={fixturePngUrl(otherFixturePngBase64)} download="other-target.png">別対象の合成写真</a></p>}
      <PhotoTrial expected="MATCH" disabled={disabled} feedback={trialFeedback.MATCH} onTest={sendTrial} onSelection={resetTrial} />
      <PhotoTrial expected="WRONG_TARGET" disabled={disabled} feedback={trialFeedback.WRONG_TARGET} onTest={sendTrial} onSelection={resetTrial} />
    </> : <form onSubmit={trial}>
      <fieldset disabled={disabled}>
        <legend>写真試験</legend>
        {realPhotoTest
          ? <p>写真試験は、保存済みの参考写真と確認済み特徴で実写真を照合します。送信ごとに、回答と共用の送信枠（上限20回）を1回消費します。参考写真と同じ対象の写真で一致を、別の対象の写真で別対象を確認してください。</p>
          : <><p>この検証環境の写真試験は、次の合成写真でのみ結果を記録します。実写真では記録されません。参考写真には一致用を登録してください。</p>
            <ul>
              <li><a href={fixturePngUrl(matchFixturePngBase64)} download="match.png">一致用の合成写真（match.png）をダウンロード</a></li>
              <li><a href={fixturePngUrl(otherFixturePngBase64)} download="other-target.png">別対象の合成写真（other-target.png）をダウンロード</a></li>
            </ul></>}
        <label>試験写真<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
          const next = event.target.files?.[0] ?? null
          if (rightsAssist && next && previousPhoto.current && rights.trim()) setReuseNeeded(true)
          if (next) previousPhoto.current = next
          setPhoto(next); key.current = null; setOutcome(null)
        }} /></label>
        {rightsAssist ? <PhotoRightsInput key={photo ? `${photo.name}:${photo.lastModified}` : 'empty'} purpose="test" label="試験写真の利用権" value={rights} onChange={(value) => {
          setRights(value); setReuseNeeded(false); key.current = null; setOutcome(null)
        }} /> : <label>試験写真の利用権<textarea value={rights} onChange={event => { setRights(event.target.value); key.current = null; setOutcome(null) }} /></label>}
        {reuseNeeded && <label><input type="checkbox" checked={false} onChange={() => setReuseNeeded(false)} />差し替えた写真を非公開試験に使う権利を確認し、入力済みの権利文を適用する</label>}
        {photo && !photoValid && <p>4 MiB以内のJPEG・PNG・WebPを選んでください。</p>}
        <button type="submit" disabled={!photoValid || !rights.trim() || reuseNeeded}>写真試験を送信</button>
      </fieldset>
    </form>}
    {!approvedAssets && proofs.MATCH && <p role="status">一致試験を確認しました。</p>}
    {!approvedAssets && proofs.WRONG_TARGET && <p role="status">別対象の試験を確認しました。</p>}
    {!approvedAssets && outcome === 'IMAGE_UNCERTAIN' && <p role="status">{realPhotoTest ? '試験写真を確認できませんでした。対象がはっきり写った別の写真でお試しください。' : '試験写真を確認できませんでした。別の合成写真でお試しください。'}</p>}
    <fieldset disabled={disabled || !reviewed}>
      <legend>{approvedAssets ? '公開' : '公開前のチェック'}</legend>
      {checkReason && <p>{checkReason}</p>}
      {!approvedAssets && confirmationLabels.map(([item, label]) => <label key={item} className="check-option">
        <input type="checkbox" checked={checked.includes(item)} onChange={(event) => {
          setChecked(event.target.checked ? [...checked, item] : checked.filter((value) => value !== item))
        }} />{label}
      </label>)}
      <button type="button" disabled={!ready || areaUnclassified} onClick={publish}>この版を公開</button>
    </fieldset>
  </section>
}
