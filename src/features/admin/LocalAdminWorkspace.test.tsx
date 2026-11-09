import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { createApiClient } from '../../shared/api'
import type { ManagedQuest } from '../../shared/api'
import type { AuthClient, AuthSnapshot } from '../auth/authTypes'
import { LocalAdminWorkspace } from './LocalAdminWorkspace'

const quest: ManagedQuest = {
  orgId: 'demo-publish', areaId: 'demo-area', questId: 'local-quest', draftRevision: 2, publishedVersion: 1,
  status: 'review_pending', shootingAreaStatus: 'configured', source: 'mock',
  draft: {
    materials: { name: '', evidence: '', photoRights: '', price: '', photoNote: '', requiresBoat: false, requiresPaidFacility: false },
    content: { title: '確認待ちの架空問題', question: '', hints: ['', '', ''], verifiedFeatures: '', draftingNotes: '' },
    afterClear: { access: '', hours: '', promoComment: '', explanation: '' }, referenceAssetId: null, hintAssetId: null,
  },
}
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: {
  'Content-Type': 'application/json', 'X-Quest-Data-Mode': 'demo',
} })
const page = (items: unknown[]) => json({ items, nextCursor: null })

it('shows team administrators who can see published content', () => {
  render(<LocalAdminWorkspace dataMode="team-preview" />)
  expect(screen.getByText(/公開した問題と公開ヒントは誰でも閲覧できます/)).toBeVisible()
})

it('confirms durable identity and membership before saving a draft with an automatic shooting area', async () => {
  const user = userEvent.setup()
  const snapshot: AuthSnapshot = { status: 'signed-in', user: { uid: 'test-manager', displayName: null } }
  const authClient: AuthClient = {
    getSnapshot: () => snapshot, subscribe: () => () => {},
    signInWithGoogle: async () => {}, signOut: async () => {}, getIdToken: async () => 'test-token',
  }
  const saved = { ...quest, source: 'real', shootingAreaStatus: 'unconfigured', draft: { ...quest.draft, referenceAssetId: 'ref' } }
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input)
    let body: unknown
    if (path === '/api/v1/session') body = { uid: snapshot.user.uid }
    else if (path.startsWith('/api/v1/me/memberships?')) body = { items: [{
      orgId: quest.orgId, areaId: quest.areaId, label: '永続の架空自治体', role: 'publisher', prefectureCode: '07',
    }], nextCursor: null }
    else if (init?.method === 'PATCH') body = { ...quest, source: 'real', draftRevision: JSON.parse(String(init.body)).expectedDraftRevision + 1,
      draft: JSON.parse(String(init.body)).draft }
    else if (path.endsWith('/readiness')) body = { quest: saved, missing: ['targetSpot', 'shootingAreas'] }
    else if (path.startsWith('/api/v1/orgs/' + quest.orgId + '/quests?')) body = { items: [saved], nextCursor: null }
    else throw new Error('Unexpected durable request: ' + path)
    return new Response(JSON.stringify(body), { headers: {
      'Content-Type': 'application/json', 'X-Quest-Data-Mode': 'durable-local',
    } })
  })
  vi.stubGlobal('fetch', fetcher)
  try {
    render(<LocalAdminWorkspace authClient={authClient} dataMode="durable-local" />)
    expect(await screen.findByText(quest.draft.content.title)).toBeVisible()
    expect(screen.getByRole('button', { name: /永続の架空自治体/ })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '編集を続ける' }))
    expect(screen.getByText('所属する組織')).not.toBeVisible()
    await user.click(screen.getByRole('button', { name: '問題一覧へ戻る' }))
    expect(screen.getByText('所属する組織')).toBeVisible()
    expect(screen.getByRole('heading', { name: '担当組織の問題' })).toHaveFocus()
    await user.click(await screen.findByRole('button', { name: '編集を続ける' }))
    expect(screen.queryByLabelText('写真の出典と利用権')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Google Maps共有URL')).not.toBeInTheDocument()
    const next = screen.getByRole('button', { name: '保存して次へ' })
    const target = screen.getByRole('textbox', { name: /^撮る“もの”の名前（非公開）$/ })
    expect(target).toHaveAttribute('aria-invalid', 'false')
    await user.click(next)
    expect(target).toHaveAttribute('aria-invalid', 'true')
    expect(target).toHaveFocus()
    expect(screen.getByLabelText('住所（クリア後に表示）')).toHaveAttribute('aria-invalid', 'true')
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
    await user.type(target, '架空の時計')
    await user.type(screen.getByLabelText('場所の名前（クリア後に表示）'), '架空の広場')
    await user.type(screen.getByLabelText('住所（クリア後に表示）'), '架空住所')
    await user.type(screen.getByLabelText('スポットの緯度'), '35')
    await user.type(screen.getByLabelText('スポットの経度'), '135')
    await user.click(next)
    expect(await screen.findByRole('heading', { name: /STEP 2/ })).toBeVisible()
    expect(screen.queryByLabelText('地図で編集する範囲')).not.toBeInTheDocument()
    const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')
    expect(writes).toHaveLength(1)
    expect(JSON.parse(String(writes[0][1]?.body))).toMatchObject({ expectedDraftRevision: 2, deriveShootingArea: true })
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/session')
    for (const [, init] of fetcher.mock.calls) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-token')
    }
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  } finally { vi.unstubAllGlobals() }
})

it('does not fall back to the memory API when the selected persistent API returns a different mode', async () => {
  const snapshot: AuthSnapshot = { status: 'signed-in', user: { uid: 'test-manager', displayName: null } }
  const authClient: AuthClient = {
    getSnapshot: () => snapshot, subscribe: () => () => {},
    signInWithGoogle: async () => {}, signOut: async () => {}, getIdToken: async () => 'test-token',
  }
  const fetcher = vi.fn<typeof fetch>(async () => json({ uid: 'test-manager' }))
  vi.stubGlobal('fetch', fetcher)
  try {
    render(<LocalAdminWorkspace authClient={authClient} dataMode="durable-local" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('ログインを確認できませんでした。')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('heading', { name: '所属する組織' })).not.toBeInTheDocument()
  } finally {
    vi.unstubAllGlobals()
  }
})

it('requires verified membership, cancels an old organization read, and shows reports only for a publisher', async () => {
  const user = userEvent.setup()
  let snapshot: AuthSnapshot = { status: 'signed-out', user: null }
  const listeners = new Set<() => void>()
  const emit = (next: AuthSnapshot) => { snapshot = next; listeners.forEach((listener) => listener()) }
  const authClient: AuthClient = {
    getSnapshot: () => snapshot, subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    signInWithGoogle: async () => emit({ status: 'signed-in', user: { uid: 'demo-user', displayName: null } }),
    signOut: async () => emit({ status: 'signed-out', user: null }),
    getIdToken: async () => 'demo-token',
  }
  let finishEditor!: (value: Response) => void
  let publishedVersion: number | null = 1
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const path = String(input)
    if (path === '/api/v1/session') return json({ uid: 'demo-user' })
    if (path.startsWith('/api/v1/me/memberships')) return page([
      { orgId: 'demo-edit', label: '編集の架空自治体', role: 'editor', areaId: 'demo-area' },
      { orgId: 'demo-publish', label: '公開の架空自治体', role: 'publisher', areaId: 'demo-area' },
    ])
    if (path.startsWith('/api/v1/orgs/demo-edit/quests')) return new Promise((resolve) => { finishEditor = resolve })
    if (path === '/api/v1/orgs/demo-publish/quests/local-quest/pause') {
      if (publishedVersion === 1) {
        publishedVersion = 2
        return new Response(JSON.stringify({ error: { code: 'QUEST_CHANGED', retryable: false } }), {
          status: 409, headers: { 'Content-Type': 'application/json', 'X-Quest-Data-Mode': 'demo' },
        })
      }
      publishedVersion = null
      return json({ ...quest, status: 'paused', draftRevision: 3, publishedVersion })
    }
    if (path.startsWith('/api/v1/orgs/demo-publish/quests')) {
      return page([publishedVersion === null ? { ...quest, publishedVersion, status: 'paused', draftRevision: 3 } : { ...quest, publishedVersion }])
    }
    if (path.startsWith('/api/v1/orgs/demo-publish/reports')) return page([{
      reportId: 'demo-report', source: 'mock', orgId: 'demo-publish', questId: 'local-quest',
      questVersion: 1, category: 'UNSAFE_GUIDANCE', text: '架空の報告本文', receivedAt: '2026-11-06T00:00:00Z',
    }])
    throw new Error('Unexpected local request')
  })
  const apiClient = createApiClient({ fetch: fetcher, expectedDataMode: 'demo', getIdToken: authClient.getIdToken })
  render(<LocalAdminWorkspace authClient={authClient} apiClient={apiClient} />)
  expect(fetcher).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Googleログイン' }))
  await user.click(await screen.findByRole('button', { name: /編集の架空自治体/ }))
  expect(screen.queryByRole('button', { name: '問題報告' })).not.toBeInTheDocument()
  await waitFor(() => expect(finishEditor).toBeTypeOf('function'))
  const oldRead = fetcher.mock.calls.find(([path]) => String(path).startsWith('/api/v1/orgs/demo-edit/quests'))?.[1]
  await user.click(screen.getByRole('button', { name: /公開の架空自治体/ }))
  expect(oldRead?.signal?.aborted).toBe(true)
  expect(await screen.findByText(quest.draft.content.title)).toBeVisible()
  await act(async () => finishEditor(page([{ ...quest, orgId: 'demo-edit', draft: { ...quest.draft, content: { ...quest.draft.content, title: '古い応答' } } }])))
  expect(screen.queryByText('古い応答')).not.toBeInTheDocument()
  const pauseOpen = screen.getByRole('button', { name: '公開を休止' })
  expect(pauseOpen).toHaveClass('danger-button')
  await user.click(pauseOpen)
  expect(screen.getByRole('button', { name: '公開を休止する' })).toHaveClass('danger-button')
  await user.click(screen.getByRole('button', { name: 'キャンセル' }))
  const pauseCalls = () => fetcher.mock.calls.filter(([path]) => String(path).endsWith('/pause'))
  expect(pauseCalls()).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: '公開を休止' }))
  await user.type(screen.getByLabelText('休止理由'), '架空の撮影確認')
  await user.click(screen.getByRole('button', { name: '公開を休止する' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('公開内容が変わりました')
  expect(pauseCalls()).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: '最新の問題一覧を確認' }))
  await user.click(await screen.findByRole('button', { name: '公開を休止' }))
  await user.type(screen.getByLabelText('休止理由'), '架空の撮影確認')
  await user.click(screen.getByRole('button', { name: '公開を休止する' }))
  expect(await screen.findByText('公開を休止しました。')).toBeVisible()
  expect(await screen.findByText('休止中')).toBeVisible()
  expect(screen.queryByText(/問題 local-quest/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '公開を休止' })).not.toBeInTheDocument()
  expect(pauseCalls().map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
    { expectedPublishedVersion: 1, reason: '架空の撮影確認' },
    { expectedPublishedVersion: 2, reason: '架空の撮影確認' },
  ])
  await user.click(screen.getByRole('button', { name: '問題報告' }))
  expect(await screen.findByText('架空の報告本文')).toBeVisible()
  expect(screen.getByText(/2026年11月6日/)).toBeInTheDocument()
  expect(document.querySelector('time')).toHaveAttribute('dateTime', '2026-11-06T00:00:00Z')
  const reportCall = fetcher.mock.calls.find(([path]) => String(path).startsWith('/api/v1/orgs/demo-publish/reports'))
  expect(new Headers(reportCall?.[1]?.headers).get('Authorization')).toBe('Bearer demo-token')
  const accountMenu = screen.getByRole('button', { name: 'アカウントメニュー' })
  expect(screen.getByRole('link', { name: '旅行者画面へ' })).toHaveClass('admin-traveler-link')
  await user.click(accountMenu)
  const travelerLink = screen.getByRole('link', { name: '旅行者画面へ' })
  expect(travelerLink).toHaveAttribute('href', '/')
  screen.getByRole('button', { name: 'ログアウト' }).focus()
  await user.keyboard('{Escape}')
  expect(accountMenu).toHaveFocus()
  expect(screen.queryByRole('button', { name: 'ログアウト' })).not.toBeInTheDocument()
  await user.click(accountMenu)
  await user.click(screen.getByRole('button', { name: 'ログアウト' }))
  expect(screen.getByRole('link', { name: '旅行者画面へ' })).toHaveAttribute('href', '/')
  expect(screen.queryByText('架空の報告本文')).not.toBeInTheDocument()
})


it.each(['demo', 'durable-local'] as const)('uses the selected %s API mode and describes its storage', async (dataMode) => {
  const snapshot: AuthSnapshot = { status: 'signed-in', user: { uid: 'demo-user', displayName: null } }
  const authClient: AuthClient = {
    getSnapshot: () => snapshot, subscribe: () => () => {},
    signInWithGoogle: async () => {}, signOut: async () => {}, getIdToken: async () => 'demo-token',
  }
  const fetcher = vi.fn<typeof fetch>(async (input) => new Response(JSON.stringify(
    String(input).endsWith('/session') ? { uid: 'demo-user' } : { items: [], nextCursor: null },
  ), { headers: { 'Content-Type': 'application/json', 'X-Quest-Data-Mode': dataMode } }))
  vi.stubGlobal('fetch', fetcher)
  try {
    render(<LocalAdminWorkspace authClient={authClient} dataMode={dataMode} />)
    expect(await screen.findByText('利用できる所属がありません。')).toBeVisible()
    expect(screen.getByText(dataMode === 'demo' ? /一時的な保存先に保存/ : /検証環境の保存先に保存/)).toBeVisible()
    if (dataMode === 'demo') {
      expect(screen.getByRole('link', { name: /ログインなしで試せるフォーム/ })).toHaveAttribute('href', '/admin-demo')
    } else {
      expect(screen.queryByRole('link', { name: /ログインなしで試せるフォーム/ })).not.toBeInTheDocument()
    }
  } finally { vi.unstubAllGlobals() }
})


it('publishes and pauses through durable session, membership and common HTTP contracts', async () => {
  const user = userEvent.setup()
  const snapshot: AuthSnapshot = { status: 'signed-in', user: { uid: 'durable-publisher', displayName: null } }
  const authClient: AuthClient = {
    getSnapshot: () => snapshot, subscribe: () => () => {}, signInWithGoogle: async () => {},
    signOut: async () => {}, getIdToken: async () => 'publisher-token',
  }
  let current: ManagedQuest = { ...quest, source: 'real', status: 'draft', publishedVersion: null,
    draft: { ...quest.draft, referenceAssetId: 'ref', afterClear: { ...quest.draft.afterClear, spot: { name: '架空', address: '架空', position: { latitude: 35, longitude: 135 } } }, materials: { ...quest.draft.materials, name: '対象' },
      content: { ...quest.draft.content, question: '問題文', hints: ['一', '二', '三'], verifiedFeatures: '特徴' } } }
  let trials = 0
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const path = String(input)
    let body: unknown
    if (path === '/api/v1/session') body = { uid: snapshot.user.uid }
    else if (path.startsWith('/api/v1/me/memberships?')) body = { items: [{
      orgId: quest.orgId, areaId: quest.areaId, label: '永続の公開自治体', role: 'publisher', prefectureCode: '07',
    }], nextCursor: null }
    else if (path.endsWith('/readiness')) body = { quest: current, missing: [] }
    else if (path.endsWith('/test')) {
      trials++
      body = { orgId: quest.orgId, questId: quest.questId, draftRevision: 2,
        source: 'mock', testId: trials === 1 ? 'match-test' : 'other-test', outcome: trials === 1 ? 'MATCH' : 'WRONG_TARGET' }
    } else if (path.endsWith('/submit-review')) {
      current = { ...current, status: 'review_pending' }; body = { quest: current, missing: [] }
    } else if (path.endsWith('/publish')) {
      current = { ...current, status: 'published', publishedVersion: 1 }; body = current
    } else if (path.endsWith('/pause')) {
      current = { ...current, status: 'paused', publishedVersion: null, draftRevision: 3 }; body = current
    } else if (path.startsWith('/api/v1/orgs/' + quest.orgId + '/quests?')) body = { items: [current], nextCursor: null }
    else throw new Error('Unexpected publication request: ' + path)
    return new Response(JSON.stringify(body), { headers: {
      'Content-Type': 'application/json', 'X-Quest-Data-Mode': 'durable-local',
    } })
  })
  vi.stubGlobal('fetch', fetcher)
  try {
    render(<LocalAdminWorkspace authClient={authClient} dataMode="durable-local" />)
    await user.click(await screen.findByRole('button', { name: /永続の公開自治体/ }))
    expect(await screen.findByText('下書き')).toBeVisible()
    await user.click(await screen.findByRole('button', { name: '編集を続ける' }))
    const publish = screen.getByRole('button', { name: '公開する' })
    expect(publish).toBeDisabled()
    expect(screen.queryByLabelText('試験写真の利用権')).not.toBeInTheDocument()
    for (const [label, message] of [['① 正解の写真でテスト', '① 正解と判定されました ✓'], ['② ちがう物の写真でテスト', '② 不正解と判定されました ✓']]) {
      await user.upload(screen.getByLabelText(label + (label.startsWith('①') ? '（同じ物を別の写真で）' : '')), new File([label], 'test.png', { type: 'image/png' }))
      await user.click(screen.getByRole('button', { name: label + 'を送信' }))
      expect(await screen.findByText(message)).toBeVisible()
      if (label === '① 正解の写真でテスト') expect(publish).toBeDisabled()
    }
    expect(screen.queryByRole('button', { name: '公開条件を確認' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '公開前のチェック' })).not.toBeInTheDocument()
    await waitFor(() => expect(publish).toBeEnabled())
    await user.click(publish)
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '公開する' }))
    expect(await screen.findByText('公開しました。')).toBeVisible()
    expect(await screen.findByText('公開中')).toBeVisible()
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-quest-id', current.questId))
    await user.click(await screen.findByRole('button', { name: '公開を休止' }))
    await user.type(screen.getByLabelText('休止理由'), '合成試験終了')
    await user.click(screen.getByRole('button', { name: '公開を休止する' }))
    expect(await screen.findByText('公開を休止しました。')).toBeVisible()
    expect(await screen.findByText('休止中')).toBeVisible()
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-quest-id', current.questId))
    expect(screen.getAllByRole('button', { name: '再公開へ' })).toHaveLength(2)
    expect(screen.queryByText(/下書き版 3/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '公開を休止' })).not.toBeInTheDocument()
    const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(writes.map(([path]) => String(path).split('/').at(-1))).toEqual(['test', 'test', 'submit-review', 'publish', 'pause'])
    expect(JSON.parse(String(writes[3][1]?.body))).toEqual({ expectedDraftRevision: 2,
      matchTestId: 'match-test', mismatchTestId: 'other-test' })
    expect(JSON.parse(String(writes[4][1]?.body))).toEqual({ expectedPublishedVersion: 1, reason: '合成試験終了' })
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/session')
    for (const [, init] of fetcher.mock.calls) expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer publisher-token')
    await user.click(within(screen.getByRole('status')).getByRole('button', { name: '再公開へ' }))
    expect(await screen.findByRole('heading', { name: /STEP 4/ })).toBeVisible()
    expect(screen.getByRole('button', { name: '公開を再開する' })).toBeVisible()
  } finally { vi.unstubAllGlobals() }
})

it('completes the shared four-step flow and guards inputs and evidence across navigation', async () => {
  const user = userEvent.setup()
  const snapshot: AuthSnapshot = { status: 'signed-in', user: { uid: 'preview-manager', displayName: null } }
  const authClient: AuthClient = {
    getSnapshot: () => snapshot, subscribe: () => () => {},
    signInWithGoogle: async () => {}, signOut: async () => {}, getIdToken: async () => 'preview-token',
  }
  let shared: ManagedQuest = { ...quest, source: 'real', status: 'draft', publishedVersion: null, shootingAreaStatus: 'unconfigured',
    draft: { ...quest.draft, referenceAssetId: 'ref' } }
  let referenceAvailable = false
  let trialCount = 0
  let releaseMatch!: () => void
  const pendingMatch = new Promise<void>((resolve) => { releaseMatch = resolve })
  const headers = { 'Content-Type': 'application/json', 'X-Quest-Data-Mode': 'team-preview' }
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input)
    let body: unknown
    if (path === '/api/v1/session') body = { uid: snapshot.user.uid }
    else if (path.startsWith('/api/v1/me/memberships?')) body = { items: [{
      orgId: quest.orgId, areaId: quest.areaId, label: '共有検証の架空自治体', role: 'editor', prefectureCode: '13',
    }], nextCursor: null }
    else if (init?.method === 'PATCH') {
      const update = JSON.parse(String(init.body))
      expect(update.expectedDraftRevision).toBe(shared.draftRevision)
      expect(update.deriveShootingArea).toBe(true)
      body = shared = { ...shared, status: 'draft', draftRevision: shared.draftRevision + 1, draft: update.draft,
        shootingAreaStatus: update.draft.afterClear.spot ? 'configured' : 'unconfigured' }
    } else if (path.endsWith('/readiness')) body = { quest: shared, missing: referenceAvailable ? [] : ['referenceAssetId'] }
    else if (path.endsWith('/submit-review')) {
      shared = { ...shared, status: 'review_pending' }
      body = { quest: shared, missing: [] }
    } else if (path.endsWith('/test')) {
      trialCount++
      const form = init?.body as FormData
      expect(JSON.parse(String(form.get('metadata')))).toEqual({ expectedDraftRevision: shared.draftRevision })
      if (trialCount === 1) return new Response(JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'invalid', retryable: false } }), { status: 400, headers })
      if (trialCount === 3) throw new Error('network offline')
      if (trialCount === 4) await pendingMatch
      const outcome = [2, 5, 7].includes(trialCount) ? 'WRONG_TARGET' : 'MATCH'
      body = { orgId: shared.orgId, questId: shared.questId, draftRevision: shared.draftRevision, source: 'mock',
        testId: 'test-' + trialCount, outcome }
    } else if (path.endsWith('/publish')) {
      const submitted = JSON.parse(String(init?.body))
      expect(submitted).toEqual({ expectedDraftRevision: shared.draftRevision, matchTestId: 'test-6', mismatchTestId: 'test-7' })
      body = shared = { ...shared, status: 'published', publishedVersion: 1 }
    } else if (path.startsWith('/api/v1/orgs/' + quest.orgId + '/quests?')) body = { items: [shared], nextCursor: null }
    else throw new Error('Unexpected preview request: ' + path)
    return new Response(JSON.stringify(body), { headers })
  })
  vi.stubGlobal('fetch', fetcher)
  try {
    render(<LocalAdminWorkspace authClient={authClient} dataMode="team-preview" />)
    await user.click(await screen.findByRole('button', { name: /共有検証の架空自治体/ }))
    await user.click(await screen.findByRole('button', { name: '編集を続ける' }))
    await user.type(screen.getByLabelText('撮る“もの”の名前（非公開）', { exact: true }), '架空の塔')
    await user.type(screen.getByLabelText('場所の名前（クリア後に表示）'), '架空の塔')
    await user.type(screen.getByLabelText('住所（クリア後に表示）'), '架空住所')
    await user.type(screen.getByLabelText('スポットの緯度'), '35')
    await user.type(screen.getByLabelText('スポットの経度'), '135')
    await user.click(screen.getByRole('button', { name: '保存して次へ' }))
    expect(await screen.findByRole('heading', { name: /STEP 2/ })).toBeVisible()
    expect(screen.getByText(/中心に半径1km/)).toBeVisible()
    expect(screen.queryByLabelText('地図で編集する範囲')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '保存して次へ' }))
    expect(await screen.findByRole('heading', { name: /STEP 3/ })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '保存して次へ' }))
    expect(screen.getByLabelText('問題文')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('ヒント 3')).toHaveAttribute('aria-invalid', 'true')
    await user.type(screen.getByLabelText('問題文'), '確認用の問題文')
    await user.type(screen.getByLabelText('ヒント 1'), '一')
    await user.type(screen.getByLabelText('ヒント 2'), '二')
    await user.type(screen.getByLabelText('ヒント 3'), '三')
    await user.type(screen.getByLabelText('AIが見分けるための特徴（非公開）'), '丸い窓')
    await user.click(screen.getByRole('button', { name: /^STEP 4\s+写真試験と公開/ }))
    expect(screen.getByRole('alertdialog', { name: '未保存の入力' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'とどまる' }))
    expect(screen.getByLabelText('問題文')).toHaveValue('確認用の問題文')
    await user.click(screen.getByRole('button', { name: '保存して次へ' }))
    await user.click(await screen.findByRole('button', { name: '写真試験と公開へ' }))
    await user.click(await screen.findByRole('button', { name: '正解の写真の入力へ' }))
    expect(await screen.findByRole('heading', { name: /STEP 1/ })).toBeVisible()
    referenceAvailable = true
    await user.click(screen.getByRole('button', { name: /^STEP 4\s+写真試験と公開/ }))
    const trial = async (label: string, photo: string) => {
      await user.upload(screen.getByLabelText(label + (label.startsWith('①') ? '（同じ物を別の写真で）' : '')), new File([photo], photo + '.png', { type: 'image/png' }))
      await user.click(screen.getByRole('button', { name: label + 'を送信' }))
    }
    const matchCard = () => within(screen.getByRole('group', { name: '① 正解の写真でテスト' }))
    await trial('① 正解の写真でテスト', 'match')
    expect(await matchCard().findByRole('alert')).toHaveTextContent('試験写真の形式と保存済みの参考写真')
    await trial('① 正解の写真でテスト', 'other')
    expect(await matchCard().findByRole('alert')).toHaveTextContent('AIの判定が予想と違いました')
    await trial('① 正解の写真でテスト', 'match')
    expect(await matchCard().findByRole('alert')).toHaveTextContent('通信に失敗しました')
    await trial('① 正解の写真でテスト', 'match')
    expect(await matchCard().findByText(/結果を確認しています/)).toBeVisible()
    releaseMatch()
    expect(await matchCard().findByText('① 正解と判定されました ✓')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /STEP 3/ }))
    await user.click(screen.getByRole('button', { name: /^STEP 4\s+写真試験と公開/ }))
    expect(await matchCard().findByText('① 正解と判定されました ✓')).toBeVisible()
    await trial('② ちがう物の写真でテスト', 'other')
    expect(await screen.findByText('② 不正解と判定されました ✓')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /STEP 3/ }))
    await user.type(screen.getByLabelText('問題文'), '。')
    await user.click(screen.getByRole('button', { name: /^STEP 4\s+写真試験と公開/ }))
    await user.click(screen.getByRole('button', { name: '保存して移動' }))
    expect(await screen.findByText(/内容を変えたので、もう一度テストしてください/)).toBeVisible()
    expect(screen.queryByText('① 正解と判定されました ✓')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '公開する' })).toBeDisabled()
    await trial('① 正解の写真でテスト', 'match')
    expect(await matchCard().findByText('① 正解と判定されました ✓')).toBeVisible()
    await trial('② ちがう物の写真でテスト', 'other')
    expect(await screen.findByText('② 不正解と判定されました ✓')).toBeVisible()
    expect(screen.queryByRole('button', { name: '公開条件を確認' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '公開前のチェック' })).not.toBeInTheDocument()
    const publish = screen.getByRole('button', { name: '公開する' })
    await waitFor(() => expect(publish).toBeEnabled())
    await user.click(publish)
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '公開する' }))
    expect(await screen.findByText('公開しました。')).toBeVisible()
    expect(fetcher.mock.calls.some(([path]) => String(path).endsWith('/shooting-areas'))).toBe(false)
  } finally { vi.unstubAllGlobals() }
}, 15_000)

it('blocks creation and explains why publication is unavailable for an unclassified area', async () => {
  const user = userEvent.setup()
  const snapshot: AuthSnapshot = { status: 'signed-in', user: { uid: 'preview-manager', displayName: null } }
  const authClient: AuthClient = {
    getSnapshot: () => snapshot, subscribe: () => () => {},
    signInWithGoogle: async () => {}, signOut: async () => {}, getIdToken: async () => 'preview-token',
  }
  const shared = { ...quest, source: 'real' } as ManagedQuest
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const path = String(input)
    let body: unknown
    if (path === '/api/v1/session') body = { uid: snapshot.user.uid }
    else if (path.startsWith('/api/v1/me/memberships?')) body = { items: [{
      orgId: quest.orgId, areaId: quest.areaId, label: '未分類の架空自治体', role: 'publisher',
    }], nextCursor: null }
    else if (path.startsWith('/api/v1/orgs/' + quest.orgId + '/quests?')) body = { items: [shared], nextCursor: null }
    else throw new Error('Unexpected preview request: ' + path)
    return new Response(JSON.stringify(body), { headers: {
      'Content-Type': 'application/json', 'X-Quest-Data-Mode': 'team-preview',
    } })
  })
  vi.stubGlobal('fetch', fetcher)
  try {
    render(<LocalAdminWorkspace authClient={authClient} dataMode="team-preview" />)
    await user.click(await screen.findByRole('button', { name: /未分類の架空自治体/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('未設定（未分類）のため、新しい問題を作成できず')
    expect(screen.queryByRole('button', { name: '下書きを新規作成' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '編集を続ける' })).toBeVisible()
  } finally { vi.unstubAllGlobals() }
})
