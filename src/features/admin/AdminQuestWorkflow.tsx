import { useEffect, useRef, useState } from 'react'
import type { ApiClient, ManagedQuest, OrgMembership, ReviewField } from '../../shared/api'
import { useRequestAction } from '../../shared/useRequestAction'
import QuestDraftForm from './QuestDraftForm'
import { HintAssetEditor } from './HintAssetEditor'
import { ShootingAreasEditor } from './ShootingAreasEditor'
import { PublicationWorkspace } from './PublicationWorkspace'

type Part = 'target' | 'conditions' | 'areas' | 'content' | 'hints' | 'publication'
const steps = ['対象と参考写真', '撮影条件', '問題とヒント', '写真試験と公開']
const stepNumber: Record<Part, number> = { target: 1, conditions: 2, areas: 2, content: 3, hints: 3, publication: 4 }

function savedSteps(record: ManagedQuest | null) {
  const content = record?.draft.content
  return [
    Boolean(record?.draft.materials.name.trim() && record.draft.referenceAssetId),
    record?.shootingAreaStatus === 'configured',
    Boolean(content?.title.trim() && content.question.trim() && content.hints.every((hint) => hint.trim()) && content.verifiedFeatures.trim()),
    record?.status === 'published',
  ]
}

function resumePart(record: ManagedQuest | null): Part {
  if (!record || record.status === 'published') return 'target'
  const [target, conditions, content] = savedSteps(record)
  if (!target) return 'target'
  if (!conditions) return 'conditions'
  return content ? 'publication' : 'content'
}

function editPart(field: ReviewField): Part {
  switch (field) {
    case 'shootingAreas': return 'areas'
    case 'hintAssetId':
    case 'hintApproval': return 'hints'
    case 'content.title':
    case 'content.question':
    case 'content.hints':
    case 'content.verifiedFeatures': return 'content'
    default: return 'target'
  }
}

export function AdminQuestWorkflow({ api, initial, member, teamPreview, photoTestSource, areaUnclassified, onBack, onPublished }: {
  api: ApiClient; initial: ManagedQuest | null; member: OrgMembership; teamPreview: boolean
  photoTestSource: 'mock' | 'real'; areaUnclassified: boolean; onBack: () => void; onPublished: () => void
}) {
  const [record, setRecord] = useState(initial)
  const [part, setPart] = useState<Part>(() => resumePart(initial))
  const [reloadState, setReloadState] = useState<{ next: Part; failed: boolean } | null>(null)
  const begin = useRequestAction()
  const heading = useRef<HTMLHeadingElement>(null)
  const step = stepNumber[part]
  const done = savedSteps(record)
  useEffect(() => {
    heading.current?.focus()
  }, [part])

  async function reload(next: Part) {
    if (!record) return
    const fail = () => setReloadState({ next, failed: true })
    const operation = begin(fail)
    if (!operation) return
    setReloadState({ next, failed: false })
    try {
      const updated = await api.getManagedQuest(member.orgId, record.questId, { signal: operation.signal })
      if (!operation.isCurrent()) return
      setRecord(updated)
      setPart(next)
      setReloadState(null)
    } catch {
      if (operation.isCurrent()) fail()
    } finally { operation.finish() }
  }

  function saved(savedRecord: ManagedQuest, advance: boolean) {
    setRecord(savedRecord)
    if (!advance) return
    if (part === 'target') setPart('conditions')
    else if (part === 'conditions') setPart('areas')
    else setPart('hints')
  }

  return <section className="admin-workflow" aria-label="問題作成">
    <ol className="workflow-steps" aria-label="問題作成の工程">
      {steps.map((label, index) => <li key={label} aria-current={index + 1 === step ? 'step' : undefined}>
        <strong>STEP {index + 1}</strong><span>{label}</span><small>{index + 1 === step ? '作業中' : done[index] ? '入力済み' : '未完了'}</small>
      </li>)}
    </ol>
    <header className="workflow-heading">
      <h2 ref={heading} tabIndex={-1}>STEP {step}　{steps[step - 1]}</h2>
      <button type="button" onClick={onBack}>問題一覧へ戻る</button>
    </header>
    {reloadState ? <>
      {reloadState.failed ? <><p role="alert">最新版を取得できませんでした。</p><button type="button" onClick={() => void reload(reloadState.next)}>読み直す</button></>
        : <p role="status">保存した下書きを確認しています…</p>}
    </> : part === 'areas' && record ? <ShootingAreasEditor enableMap api={api} orgId={member.orgId} questId={record.questId}
      onBack={() => reload('conditions')} backLabel="撮影条件の入力へ" onContinue={() => reload('content')} />
      : part === 'hints' && record ? <HintAssetEditor api={api} initial={record} member={member} onBack={() => reload('content')}
        backLabel="問題文に戻る" onContinue={(savedRecord) => { setRecord(savedRecord); setPart('publication') }} />
      : part === 'publication' && record ? <PublicationWorkspace api={api} initial={record} approvedAssets photoTestSource={photoTestSource}
        areaUnclassified={areaUnclassified} onBack={() => setPart('content')} backLabel="問題とヒントへ戻る"
        onFix={(field) => setPart(editPart(field))} onPublished={onPublished} />
      : <>
        {part !== 'target' && <button type="button" onClick={() => setPart(part === 'conditions' ? 'target' : 'conditions')}>前の工程へ</button>}
        <QuestDraftForm key={part} teamPreview={teamPreview} connection={{ workflowPart: part === 'conditions' ? 2 : part === 'content' ? 3 : 1,
          api, initial: record, member, onBack, onWorkflowSave: saved }} />
      </>}
  </section>
}
