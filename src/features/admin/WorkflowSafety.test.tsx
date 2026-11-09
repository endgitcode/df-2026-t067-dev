import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AdminQuestWorkflow } from './AdminQuestWorkflow'
import QuestDraftForm from './QuestDraftForm'
import { LocalAdminWorkspace } from './LocalAdminWorkspace'
import { createApiClient, type ManagedQuest } from '../../shared/api'

const member = { orgId: 'org', areaId: 'area', label: '架空自治体', role: 'editor' as const }
const initial: ManagedQuest = {
  orgId: 'org', questId: 'q', areaId: 'area', draftRevision: 1, publishedVersion: null,
  source: 'real', status: 'draft', shootingAreaStatus: 'configured',
  draft: { materials: { name: '対象', evidence: '', requiresBoat: false, requiresPaidFacility: false, price: '', photoNote: '', photoRights: '' },
    content: { title: '問題', question: '文章', hints: ['一', '二', '三'], verifiedFeatures: '特徴', draftingNotes: '' },
    afterClear: { hours: '', access: '', promoComment: '', explanation: '' }, referenceAssetId: 'ref', hintAssetId: null },
}
afterEach(() => { cleanup(); history.replaceState(null, '', '/'); vi.restoreAllMocks() })
function api() {
  return { ...createApiClient(), getManagedQuestReadiness: vi.fn().mockRejectedValue(new Error('offline')),
    updateManagedQuest: vi.fn().mockImplementation(async (_org, _id, input) => ({ ...initial, draft: input.draft, draftRevision: 2 })) }
}
it('guards only dirty edits, restores URL step, and offers three focused navigation choices', async () => {
  history.replaceState(null, '', '/?quest=q&step=target')
  const client = api(); const onBack = vi.fn()
  render(<AdminQuestWorkflow api={client} initial={initial} member={member} teamPreview={false} photoTestSource="mock" areaUnclassified={false} onBack={onBack} onPublished={vi.fn()} />)
  expect(screen.getByRole('heading', { name: /STEP 1/ })).toBeVisible()
  expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true)
  fireEvent.change(screen.getByLabelText('撮る“もの”の名前（非公開）'), { target: { value: '変更' } })
  expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'STEP 2 条件と案内' }))
  expect(screen.getByRole('alertdialog')).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'とどまる' }))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'STEP 2 条件と案内' }))
  fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))
  await screen.findByRole('heading', { name: /STEP 2/ })
  expect(client.updateManagedQuest).toHaveBeenCalledTimes(1)
  expect(new URLSearchParams(location.search).get('step')).toBe('conditions')
  expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true)
})
it('blocks reversed hours and negative or fractional prices, then resets success on failed save', async () => {
  const client = api()
  render(<QuestDraftForm connection={{ api: client, initial, member, taskFocused: true, onBack: vi.fn() }} />)
  fireEvent.click(screen.getByText('クリア後に見せる案内（任意）'))
  fireEvent.click(screen.getByRole('radio', { name: '時間を指定' }))
  fireEvent.change(screen.getByLabelText('開始時刻'), { target: { value: '18:00' } })
  fireEvent.change(screen.getByLabelText('終了時刻'), { target: { value: '09:00' } })
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  expect(client.updateManagedQuest).not.toHaveBeenCalled()
  expect(screen.getByLabelText('終了時刻')).toHaveAccessibleDescription(/終了時刻は/)
  fireEvent.click(screen.getByLabelText('終了は翌日'))
  fireEvent.change(screen.getByLabelText('料金の区分'), { target: { value: '有料' } })
  for (const value of ['-50', '1.5', '1e3']) {
    fireEvent.change(screen.getByLabelText('金額（円）'), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    expect(client.updateManagedQuest).not.toHaveBeenCalled()
    expect(screen.getByLabelText('料金の補足')).toHaveValue('')
    expect(screen.getByLabelText('金額（円）')).toHaveAccessibleDescription('金額は0以上の整数で入力してください。')
  }
  fireEvent.change(screen.getByLabelText('金額（円）'), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  expect(await screen.findByText('下書きを保存しました。')).toHaveFocus()
  client.updateManagedQuest.mockRejectedValue(new Error('offline'))
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  expect(screen.queryByText('下書きを保存しました。')).toBeNull()
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('下書きを保存できませんでした'))
})
it('never creates an empty draft and discards only after choosing to leave without saving', () => {
  const client = { ...api(), createManagedQuest: vi.fn() }; const onBack = vi.fn()
  render(<AdminQuestWorkflow api={client} initial={null} member={member} teamPreview={false} photoTestSource="mock" areaUnclassified={false} onBack={onBack} onPublished={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  expect(client.createManagedQuest).not.toHaveBeenCalled()
  expect(screen.getByText('下書きを保存するには対象名または問題タイトルを入力してください。')).toBeVisible()
  fireEvent.change(screen.getByLabelText('撮る“もの”の名前（非公開）'), { target: { value: '未保存' } })
  fireEvent.click(screen.getByRole('button', { name: '問題一覧へ戻る' }))
  expect(onBack).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '保存せず移動' }))
  expect(onBack).toHaveBeenCalledTimes(1)
})
it.each(['q&step=content', 'missing&step=target', 'q&step=unknown'])('restores only valid quest and step URLs: %s', async value => {
  history.replaceState(null, '', '/?quest=' + value)
  const client = { ...api(), getSession: vi.fn().mockResolvedValue({ uid: 'manager' }),
    listMemberships: vi.fn().mockResolvedValue({ items: [{ ...member, prefectureCode: '07' }], nextCursor: null }),
    listManagedQuests: vi.fn().mockResolvedValue({ items: [initial], nextCursor: null }),
    getManagedQuest: vi.fn().mockRejectedValue(new Error('not found')) }
  const snapshot = { status: 'signed-in' as const, user: { uid: 'manager', displayName: null } }
  render(<LocalAdminWorkspace dataMode="durable-local" apiClient={client} authClient={{
    getSnapshot: () => snapshot, subscribe: () => () => {}, getIdToken: async () => 'test', signInWithGoogle: async () => {}, signOut: async () => {},
  }} />)
  if (value === 'q&step=content') {
    expect(await screen.findByRole('heading', { name: /STEP 3/ })).toBeVisible()
    expect(screen.getByLabelText('問題タイトル')).toHaveValue('問題')
    await waitFor(() => expect(screen.getByText('所属する組織')).not.toBeVisible())
  } else {
    await waitFor(() => expect(location.search).toBe(''))
    expect(screen.getByRole('heading', { name: '担当組織の問題' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: /STEP/ })).toBeNull()
  }
})

it.each([
  ['draft', '下書き', '公開する'], ['published', '公開中', '修正を公開する'], ['paused', '休止中', '公開を再開する'],
] as const)('shows %s status beside the workflow heading and names the publication action', async (status, label, action) => {
  history.replaceState(null, '', '/?quest=q&step=publication')
  const record = { ...initial, status }
  const client = { ...api(), getManagedQuestReadiness: vi.fn().mockResolvedValue({ quest: record, missing: [] }) }
  render(<AdminQuestWorkflow api={client} initial={record} member={member} teamPreview photoTestSource="mock" areaUnclassified={false} onBack={vi.fn()} onPublished={vi.fn()} />)
  expect(screen.getByText(label).closest('header')).toContainElement(screen.getByRole('heading', { name: /STEP 4/ }))
  expect(screen.getByRole('button', { name: action })).toBeVisible()
  expect(screen.getAllByRole('button', { name: '問題一覧へ戻る' })).toHaveLength(1)
  await waitFor(() => expect(client.getManagedQuestReadiness).toHaveBeenCalled())
})

it('lists every missing field, disables both photo trials, and focuses the selected field', async () => {
  history.replaceState(null, '', '/?quest=q&step=publication')
  const client = { ...api(), getManagedQuestReadiness: vi.fn().mockResolvedValue({ quest: initial, missing: ['materials.name', 'referenceAssetId', 'content.question', 'content.hints'] }) }
  render(<AdminQuestWorkflow api={client} initial={initial} member={member} teamPreview photoTestSource="mock" areaUnclassified={false} onBack={vi.fn()} onPublished={vi.fn()} />)
  for (const label of ['撮る“もの”の名前（非公開）', '正解の写真', '問題文', '3本のヒント']) expect(await screen.findByRole('button', { name: label + 'の入力へ' })).toBeVisible()
  expect(screen.getByLabelText('① 正解の写真でテスト（同じ物を別の写真で）')).toBeDisabled()
  expect(screen.getByLabelText('② ちがう物の写真でテスト')).toBeDisabled()
  expect(screen.getByText('不足項目をすべて修正すると写真試験を送信できます。')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '3本のヒントの入力へ' }))
  expect(screen.getByLabelText('ヒント 1')).toHaveFocus()
})

it('automatically opens the only team-preview organization', async () => {
  sessionStorage.clear()
  const client = { ...api(), getSession: vi.fn().mockResolvedValue({ uid: 'manager' }),
    listMemberships: vi.fn().mockResolvedValue({ items: [{ ...member, prefectureCode: '07' }], nextCursor: null }),
    listManagedQuests: vi.fn().mockResolvedValue({ items: [initial], nextCursor: null }) }
  const snapshot = { status: 'signed-in' as const, user: { uid: 'manager', displayName: null } }
  render(<LocalAdminWorkspace dataMode="team-preview" apiClient={client} authClient={{ getSnapshot: () => snapshot, subscribe: () => () => {}, getIdToken: async () => 'test', signInWithGoogle: async () => {}, signOut: async () => {} }} />)
  expect(await screen.findByText('問題')).toBeVisible()
  expect(client.listManagedQuests).toHaveBeenCalledWith(member.orgId, expect.anything(), expect.anything())
})
