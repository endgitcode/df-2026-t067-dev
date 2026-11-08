import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, parsePublishManagedQuest } from '../../shared/api'
import type { ApiClient, ManagedQuest, OrgMembership, PhotoDecision, PublishManagedQuest, ReviewField } from '../../shared/api'
import { PhotoRightsInput } from './PhotoRightsInput'
import { fixturePngUrl, matchFixturePngBase64, otherFixturePngBase64 } from './photoTestFixtures'
import { useRequestAction } from '../../shared/useRequestAction'

const reviewLabels: Record<ReviewField, string> = {
  'materials.name': '対象名', 'materials.evidence': '対象にした理由（確認したこと）', 'materials.photoRights': '写真の利用権',
  referenceAssetId: '参考写真', hintAssetId: 'ヒント画像の用途', shootingAreas: '撮影できる範囲（非公開）',
  'content.title': '問題タイトル', 'content.question': '問題文', 'content.hints': '3本のヒント',
  'content.verifiedFeatures': '現地で確かめた見た目の特徴',
}
type Confirmation = keyof PublishManagedQuest['confirmations']
const confirmationLabels: ReadonlyArray<readonly [Confirmation, string]> = [
  ['fictionalData', '架空の素材と情報だけを使った'],
  ['visitConditions', '訪問条件と撮影時の注意を確認した'],
  ['photoRights', '写真の権利と公開する画像を確認した'],
  ['shootingArea', '撮影できる範囲（非公開）を確認した'],
  ['testCases', '一致と別対象の試験を確認した'],
]
type Failure = { message: string; stale?: true }
type TestProofs = Partial<Record<'MATCH' | 'WRONG_TARGET', string>>

function publicationFailure(cause: unknown, realPhotoTest: boolean): Failure {
  const code = cause instanceof ApiError ? cause.code : undefined
  switch (code) {
    case 'DRAFT_CONFLICT': return { message: '下書きの版が変わりました。一覧から最新版を確認してください。', stale: true }
    case 'FORBIDDEN': return { message: '担当組織の操作権限を確認できません。', stale: true }
    case 'PHOTO_TEST_REQUIRED': return { message: 'この版で異なる写真を使って一致・別対象の試験を確認してください。' }
    case 'REVIEW_REQUIRED': return { message: 'この版の確認依頼と確認項目を見直してください。' }
    case 'INVALID_INPUT': return { message: '試験写真・利用権と保存済みの参考素材を確認してください。' }
    case 'RATE_LIMITED': return { message: '試験の受付上限に達しました。時間をおいて再試行してください。' }
    case 'SYSTEM_ERROR': return realPhotoTest
      ? { message: '試験を処理できませんでした。時間をおいて再試行してください。' }
      : { message: '試験を処理できませんでした。この検証環境では合成写真でのみ記録されるため、実写真では結果が残りません。' }
    default: return { message: '結果を確認できませんでした。通信状況を確認して再試行してください。' }
  }
}

export function PublicationWorkspace({ api, initial, member, onBack, onPublished, rightsAssist = false, backLabel = '問題一覧へ戻る', photoTestSource = 'mock', areaUnclassified = false }: {
  api: ApiClient; initial: ManagedQuest; member: OrgMembership; rightsAssist?: boolean; backLabel?: string; photoTestSource?: 'mock' | 'real'; areaUnclassified?: boolean; onBack: () => void; onPublished: () => void
}) {
  const [quest, setQuest] = useState(initial)
  const [photo, setPhoto] = useState<File | null>(null)
  const [rights, setRights] = useState('')
  const [reuseNeeded, setReuseNeeded] = useState(false)
  const previousPhoto = useRef<File | null>(null)
  const key = useRef<string | null>(null)
  const [outcome, setOutcome] = useState<PhotoDecision | null>(null)
  const [proofs, setProofs] = useState<TestProofs>({})
  const [missing, setMissing] = useState<ReviewField[]>([])
  const [checked, setChecked] = useState<Confirmation[]>([])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const begin = useRequestAction()
  const { orgId, questId, draftRevision } = quest
  const disabled = busy || !!failure?.stale
  const photoValid = photo !== null && photo.size > 0 && photo.size <= 4 * 1024 * 1024 &&
    ['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)
  const reviewed = quest.status === 'review_pending' && !!proofs.MATCH && !!proofs.WRONG_TARGET
  const ready = reviewed && confirmationLabels.every(([item]) => checked.includes(item))
  const realPhotoTest = photoTestSource === 'real'

  async function perform<T>(work: (signal: AbortSignal) => Promise<T>, receive: (value: T) => void) {
    if (failure?.stale) return
    const operation = begin(() => {
      setFailure({ message: '操作の確認に時間がかかっています。通信状況を確認してください。' })
      setBusy(false)
    })
    if (!operation) return
    setBusy(true)
    setFailure(null)
    try {
      const result = await work(operation.signal)
      if (operation.isCurrent()) receive(result)
    } catch (cause) {
      if (operation.isCurrent()) setFailure(publicationFailure(cause, realPhotoTest))
    } finally {
      if (operation.isCurrent()) setBusy(false)
      operation.finish()
    }
  }

  function trial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!photoValid || !rights.trim() || reuseNeeded) return
    void perform((signal) => api.testManagedQuest(orgId, questId, {
      expectedDraftRevision: draftRevision, photo, photoRights: rights,
      idempotencyKey: key.current ??= crypto.randomUUID(),
    }, { signal }), (result) => {
      if (result.source !== photoTestSource) throw new ApiError('INVALID_RESPONSE')
      setOutcome(result.outcome)
      setChecked([])
      if (result.outcome !== 'IMAGE_UNCERTAIN') {
        setProofs((current) => ({ ...current, [result.outcome]: result.testId }))
      }
    })
  }

  function review() {
    void perform((signal) => api.submitManagedQuestReview(orgId, questId, draftRevision, { signal }), (result) => {
      setQuest(result.quest)
      setMissing(result.missing)
      setChecked([])
    })
  }

  function publish() {
    if (!ready || member.role !== 'publisher') return
    void perform((signal) => api.publishManagedQuest(orgId, questId, parsePublishManagedQuest({
      expectedDraftRevision: draftRevision, matchTestId: proofs.MATCH, mismatchTestId: proofs.WRONG_TARGET,
      confirmations: Object.fromEntries(checked.map((item) => [item, true])),
    }), { signal }), onPublished)
  }

  return <section className="form-section" aria-labelledby="publication-workspace-title">
    <h2 id="publication-workspace-title">写真試験と公開確認</h2>
    <p>{quest.draft.content.title || '無題の下書き'}・下書き版 {draftRevision}</p>
    <p>{realPhotoTest ? '開発用の検証環境です。写真試験は実写真で照合します。' : '開発用の検証環境です。合成写真を使います。'}</p>
    <button type="button" onClick={onBack}>{backLabel}</button>
    {areaUnclassified && <p role="alert">この地域は都道府県コードが未設定（未分類）のため、公開できません。地域の分類が完了するまで公開は止まります。</p>}
    {failure && <p role="alert">{failure.message}</p>}
    {busy && <p role="status">操作結果を確認しています…</p>}
    <form onSubmit={trial}>
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
    </form>
    {proofs.MATCH && <p role="status">一致試験を確認しました。</p>}
    {proofs.WRONG_TARGET && <p role="status">別対象の試験を確認しました。</p>}
    {outcome === 'IMAGE_UNCERTAIN' && <p role="status">{realPhotoTest ? '試験写真を確認できませんでした。対象がはっきり写った別の写真でお試しください。' : '試験写真を確認できませんでした。別の合成写真でお試しください。'}</p>}
    <fieldset disabled={disabled}>
      <legend>確認依頼</legend>
      <button type="button" onClick={review}>この版の確認を依頼</button>
      {quest.status === 'review_pending' && <p role="status">この下書きは確認待ちです。</p>}
      {missing.length > 0 && <><p>次の項目を確認してください。</p><ul>{missing.map((item) => <li key={item}>{reviewLabels[item]}</li>)}</ul></>}
    </fieldset>
    {member.role === 'publisher' ? <fieldset disabled={disabled || !reviewed}>
      <legend>公開担当者の確認</legend>
      {confirmationLabels.map(([item, label]) => <label key={item} className="check-option">
        <input type="checkbox" checked={checked.includes(item)} onChange={(event) => {
          setChecked(event.target.checked ? [...checked, item] : checked.filter((value) => value !== item))
        }} />{label}
      </label>)}
      <button type="button" disabled={!ready} onClick={publish}>この版を公開</button>
    </fieldset> : <fieldset disabled>
      <legend>公開担当者の確認</legend>
      <p>公開の確認と実行は公開担当が行います。編集担当は確認依頼までを行ってください。</p>
      <p>写真試験の結果はこの画面を開いている間だけ保持されるため、公開担当が自分の画面で写真試験を再度実施してから公開します。</p>
      {confirmationLabels.map(([, label]) => <label key={label} className="check-option">
        <input type="checkbox" checked={false} readOnly />{label}
      </label>)}
      <button type="button" disabled>この版を公開</button>
    </fieldset>}
  </section>
}
