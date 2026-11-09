import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiClient, ManagedQuest, OrgMembership, ReviewField } from '../../shared/api'
import { useRemote } from '../../shared/useRemote'
import QuestDraftForm from './QuestDraftForm'
import { HintAssetEditor } from './HintAssetEditor'
import { PublicationWorkspace } from './PublicationWorkspace'
import { reviewLabels } from './publicationReadiness'

type Part = 'target' | 'conditions' | 'content' | 'hints' | 'publication'
type Destination = { part: Part; field?: ReviewField } | 'list'
const steps = ['対象と参考写真', '撮影条件', '問題とヒント', '写真試験と公開']
const defaultParts: Part[] = ['target', 'conditions', 'content', 'publication']
const stepNumber: Record<Part, number> = { target: 1, conditions: 2, content: 3, hints: 3, publication: 4 }
const inputTargets: Partial<Record<ReviewField, string>> = {
  'materials.name': 'workflow-target-name', referenceAssetId: 'workflow-reference', referenceApproval: 'workflow-reference',
  targetSpot: 'workflow-spot', shootingAreas: 'workflow-spot', hintApproval: 'workflow-hint-image', hintAssetId: 'workflow-hint-image',
  'content.title': 'workflow-title', 'content.question': 'workflow-question', 'content.hints': 'workflow-hints', 'content.verifiedFeatures': 'workflow-features',
}

function editPart(field: ReviewField): Part {
  if (field === 'hintAssetId' || field === 'hintApproval') return 'hints'
  if (field.startsWith('content.')) return 'content'
  return 'target'
}

function fieldStep(field: ReviewField) {
  return field === 'shootingAreas' ? 2 : stepNumber[editPart(field)]
}

function localMissing(record: ManagedQuest | null): ReviewField[] {
  const draft = record?.draft
  return [
    ...(!draft?.materials.name.trim() ? ['materials.name'] as const : []),
    ...(!draft?.referenceAssetId ? ['referenceAssetId'] as const : []),
    ...(!draft?.afterClear.spot ? ['targetSpot'] as const : []),
    ...(record?.shootingAreaStatus !== 'configured' ? ['shootingAreas'] as const : []),
    ...(!draft?.content.title.trim() ? ['content.title'] as const : []),
    ...(!draft?.content.question.trim() ? ['content.question'] as const : []),
    ...(!draft?.content.hints.every((hint) => hint.trim()) ? ['content.hints'] as const : []),
    ...(!draft?.content.verifiedFeatures.trim() ? ['content.verifiedFeatures'] as const : []),
  ]
}

function resumePart(record: ManagedQuest | null): Part {
  const missing = localMissing(record)
  if (!record || record.status === 'published') return 'target'
  if (missing.some((field) => fieldStep(field) === 1)) return 'target'
  if (missing.includes('shootingAreas')) return 'target'
  return missing.length ? 'content' : 'publication'
}

export function AdminQuestWorkflow({ api, initial, member, teamPreview, photoTestSource, areaUnclassified, onBack, onPublished }: {
  api: ApiClient; initial: ManagedQuest | null; member: OrgMembership; teamPreview: boolean
  photoTestSource: 'mock' | 'real'; areaUnclassified: boolean; onBack: () => void; onPublished: () => void
}) {
  const [record, setRecord] = useState(initial)
  const [part, setPart] = useState<Part>(() => resumePart(initial))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Destination | null>(null)
  const [focusField, setFocusField] = useState<ReviewField | null>(null)
  const [lastTrialRevision, setLastTrialRevision] = useState<number | null>(null)
  const [openedPublication, setOpenedPublication] = useState(part === 'publication')
  const heading = useRef<HTMLHeadingElement>(null)
  const root = useRef<HTMLElement>(null)
  const step = stepNumber[part]
  const questId = record?.questId
  const revision = record?.draftRevision
  const read = useCallback((signal: AbortSignal) => api.getManagedQuestReadiness(member.orgId, questId!, { signal }), [api, member.orgId, questId])
  const { result, retry } = useRemote(Boolean(questId), read)
  const remote = result.status === 'ready' ? result.value : undefined
  const readiness = remote?.quest.draftRevision === revision ? remote : undefined
  const newerVersion = remote && !readiness
  const missing = readiness?.missing ?? localMissing(record)
  const currentMissing = missing.filter((field) => fieldStep(field) === step)

  useEffect(() => {
    const id = focusField && inputTargets[focusField]
    const field = id && root.current?.querySelector<HTMLElement>('#' + id)
    if (field) field.focus()
    else heading.current?.focus()
  }, [part, focusField])

  function move(destination: Destination) {
    setPending(null)
    setDirty(false)
    if (destination === 'list') { onBack(); return }
    setPart(destination.part)
    setFocusField(destination.field ?? null)
    if (destination.part === 'publication') {
      setOpenedPublication(true)
      retry()
    }
  }

  function navigate(destination: Destination) {
    if (busy) return
    if (destination !== 'list' && destination.part === part) {
      const id = destination.field && inputTargets[destination.field]
      if (id) root.current?.querySelector<HTMLElement>('#' + id)?.focus()
      return
    }
    if (dirty) setPending(destination)
    else move(destination)
  }

  function saved(savedRecord: ManagedQuest, advance: boolean) {
    setRecord(savedRecord)
    setDirty(false)
    retry()
    if (pending) { move(pending); return }
    if (advance) move({ part: part === 'target' ? 'conditions' : part === 'conditions' ? 'content' : 'hints' })
  }

  function fix(field: ReviewField) { navigate({ part: editPart(field), field }) }

  return <section className="admin-workflow" aria-label="問題作成" ref={root}>
    <ol className="workflow-steps" aria-label="問題作成の工程">
      {steps.map((label, index) => {
        const number = index + 1
        const count = missing.filter((field) => fieldStep(field) === number).length
        const progress = number === 4 ? record?.status === 'published' ? '公開済み' : '試験・公開確認' :
          count ? `不足 ${count}件` : readiness ? '入力済み' : '確認待ち'
        return <li key={label} aria-current={number === step ? 'step' : undefined}>
          <button type="button" aria-label={`STEP ${number} ${label}、${progress}`} disabled={busy} onClick={() => navigate({ part: defaultParts[index] })}>
            <strong>STEP {number}</strong><span>{label}</span><small>{progress}</small>
          </button>
        </li>
      })}
    </ol>
    <header className="workflow-heading">
      <h2 ref={heading} tabIndex={-1}>STEP {step}　{steps[step - 1]}</h2>
      <button type="button" disabled={busy} onClick={() => navigate('list')}>問題一覧へ戻る</button>
    </header>
    {pending && <div role="group" aria-label="未保存の入力">
      <p>未保存の入力があります。「下書きを保存」または「ヒント画像を保存」を押すと移動します。</p>
      <button type="button" disabled={busy} onClick={() => setPending(null)}>この工程にとどまる</button>
      <button type="button" disabled={busy} onClick={() => move(pending)}>保存せず移動</button>
    </div>}
    {step !== 4 && <>
      <button type="button" disabled={busy} onClick={() => navigate({ part: 'publication' })}>STEP 4へ移動</button>
      {currentMissing.some((field) => field === 'referenceApproval' || field === 'hintApproval') &&
        <p>保存済みの写真は、運営に承認を依頼するか、承認済みの写真に差し替えてください。</p>}
      {currentMissing.length > 0 && <ul aria-label="この工程の不足項目">
        {currentMissing.map((field) => <li key={field}><button type="button" disabled={busy} onClick={() => fix(field)}>{reviewLabels[field]}を確認</button></li>)}
      </ul>}
    </>}
    {part === 'conditions' && <p>撮影範囲は、STEP 1で保存した対象スポットの位置を中心に半径1kmです。
      {missing.includes('targetSpot') || missing.includes('shootingAreas') ? ' STEP 1でスポットを保存してください。' : ' 設定済みです。'}</p>}
    {part === 'hints' && record ? <HintAssetEditor api={api} initial={record} member={member}
      onBack={() => navigate({ part: 'content' })} backLabel="問題文に戻る" onDirty={setDirty} onSaving={setBusy}
      onSaved={(updated) => saved(updated, false)} onContinue={(updated) => { setRecord(updated); if (!pending) move({ part: 'publication' }) }} />
      : part !== 'publication' && <QuestDraftForm key={part} teamPreview={teamPreview} connection={{
        workflowPart: part === 'conditions' ? 2 : part === 'content' ? 3 : 1,
        api, initial: record, member, onBack, onWorkflowSave: saved, onDirty: setDirty, onSaving: setBusy,
      }} />}
    {part === 'publication' && !record && <p>STEP 1〜3のいずれかで下書きを保存すると、公開準備を始められます。</p>}
    {part === 'publication' && newerVersion && <p role="alert">別の操作で下書きの版が更新されました。
      <button type="button" disabled={busy} onClick={() => setRecord(remote.quest)}>最新版を読み込む</button>
    </p>}
    {part === 'publication' && lastTrialRevision !== null && lastTrialRevision !== revision &&
      <p role="status">下書きの版が変わったため、以前の写真試験は使えません。この版で再試験してください。</p>}
    {record && openedPublication && <div hidden={part !== 'publication'}>
      <PublicationWorkspace key={revision} api={api} initial={record} approvedAssets photoTestSource={photoTestSource}
        areaUnclassified={areaUnclassified} onBack={() => navigate({ part: 'content' })} backLabel="問題とヒントへ戻る"
        onFix={fix} onPublished={onPublished} onBusy={setBusy} onTrialConfirmed={() => setLastTrialRevision(record.draftRevision)}
        readiness={readiness} readinessFailed={result.status === 'error'} onReadinessRetry={retry} />
    </div>}
  </section>
}
