import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { MouseEvent } from 'react'
import { demoAreaLabel, demoQuest, demoQuestHints } from './features/quests/demoQuest'
import { QuestDetails } from './features/quests/QuestDetails'
import { QuestReport } from './features/quests/QuestReport'
import type { ChallengeSelection } from './features/quests/QuestDetails'
import { MapPreview } from './features/explore/MapPreview'
import { scrollBelowHeader } from './features/explore/scrollBelowHeader'
import { Icon } from './components/Icon'
import type { AuthClient, AuthSnapshot } from './features/auth/authTypes'
import type { PublicArea, PublicQuest } from './shared/api/types'
import type { QuestHint } from './shared/api/types'
import { createApiClient } from './shared/api'
import type { ApiClient, LocalApiDataMode } from './shared/api'
import { CameraPreview } from './features/capture/CameraPreview'
import { ChallengeCapture } from './features/capture/ChallengeCapture'
import { OwnerDiscoveries } from './features/discoveries/OwnerDiscoveries'
import { readDataSource, useAdminMembership, useQuestConnection, useServerIdentity } from './features/explore/useQuestConnection'
import { useWideViewport } from './features/quests/useWideViewport'
import { AuthError, createFirebaseAuthClient } from './features/auth/firebaseAuth'
import './App.css'

function connectionNotice(auth: AuthSnapshot, durableLocal: boolean): { title: string; description: string } {
  const previewNote = durableLocal ? '' : '写真判定・記録保存は準備中です。'
  switch (auth.status) {
    case 'unconfigured':
      return { title: 'ログイン準備中', description: '問題はログインなしで閲覧できます。ログイン機能は準備中です。' }
    case 'unavailable':
      return { title: 'Googleログインを利用できません', description: auth.message }
    case 'checking':
      return { title: 'ログイン状態を確認中', description: '問題はそのまま閲覧できます。しばらくお待ちください。' }
    case 'signed-out':
      return { title: 'ゲストで閲覧中', description: '問題はログインなしで閲覧できます。' + previewNote }
    case 'signed-in':
      return { title: 'Googleログイン済み', description: (auth.user.displayName ?? 'Googleアカウント') + 'でログインしています。' + previewNote }
  }
}

type AppProps = {
  authClient?: AuthClient
  onStartChallenge?: (selection: ChallengeSelection) => void | Promise<unknown>
  quest?: PublicQuest
  mapAreas?: PublicArea[]
  mapQuests?: PublicQuest[]
  onOpenQuest?: (questId: string) => void
  selectedAreaId?: string
  onSelectArea?(areaId: string): void
  areaLabel?: string
  openQuestRequest?: { questId: string; sequence: number }
  questPicker?: ReactNode
  catalogFallback?: ReactNode
  /** 地図がシート表示（使える状態）かどうかを MapPreview から受け取る。問題の選択手段の
      出し分け（地図が使える間はピッカーを出さない、D-43）を呼び出し側が判断するために使う。 */
  onMapSheetModeChange?: (sheetMode: boolean) => void
  mapOverlay?: ReactNode
  apiMode?: boolean
  apiDataMode?: LocalApiDataMode
  teamAnswerTrial?: boolean
  apiClient?: ApiClient
  onReloadQuest?: (event?: MouseEvent<HTMLButtonElement>) => void
  getHint?: ApiClient['getHint']
  questStale?: boolean
  onHintVersionStale?(): void
}

async function getPreviewHint(input: { questId: string; expectedVersion: number; index: number }, call?: { signal?: AbortSignal }): Promise<QuestHint> {
  call?.signal?.throwIfAborted()
  if (input.questId !== demoQuest.questId || input.expectedVersion !== demoQuest.version || !Number.isInteger(input.index) || input.index < 1 || input.index > demoQuestHints.length) {
    throw new Error('Preview hint is unavailable')
  }
  return { questId: input.questId, version: input.expectedVersion, index: input.index, text: demoQuestHints[input.index - 1] }
}

function waitForSignedIn(authClient: AuthClient, signal: AbortSignal): Promise<boolean> {
  if (authClient.getSnapshot().status === 'signed-in') return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    let unsubscribe: (() => void) | null = null
    const finish = (signedIn: boolean) => {
      if (settled) return
      settled = true
      unsubscribe?.()
      window.clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      resolve(signedIn)
    }
    const check = () => {
      const status = authClient.getSnapshot().status
      if (status === 'signed-in') finish(true)
      else if (status === 'unavailable' || status === 'unconfigured') finish(false)
    }
    const abort = () => finish(false)
    const timeout = window.setTimeout(() => finish(false), 5000)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    if (settled) return
    unsubscribe = authClient.subscribe(check)
    if (settled) unsubscribe?.()
    check()
  })
}

export default function App({ authClient: providedClient, apiClient: providedApi, onStartChallenge, onReloadQuest, getHint: providedGetHint, questStale: providedQuestStale = false, onHintVersionStale, quest: externalQuest, mapAreas = [], mapQuests = [], onOpenQuest, selectedAreaId = '', onSelectArea, areaLabel: externalAreaLabel, openQuestRequest, questPicker, catalogFallback, mapOverlay, onMapSheetModeChange, apiMode = false, apiDataMode = 'demo', teamAnswerTrial: teamAnswerTrialProp = false }: AppProps = {}) {
  const [openState, setOpenState] = useState<{ quest?: PublicQuest; open: boolean }>({ open: false })
  const isQuestOpen = openState.quest === externalQuest && openState.open
  const [openedRequest, setOpenedRequest] = useState<typeof openQuestRequest>()
  if (openQuestRequest && openQuestRequest !== openedRequest && externalQuest?.questId === openQuestRequest.questId) {
    setOpenedRequest(openQuestRequest)
    setOpenState({ quest: externalQuest, open: true })
  }

  const [recordDestination, setRecordDestination] = useState<{ auth: AuthSnapshot; id: string } | null>(null)
  const [recordsOpen, setRecordsOpen] = useState(false)
  const questCard = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (isQuestOpen && openedRequest && document.querySelector('.is-browsing-below-map')) {
      scrollBelowHeader(questCard.current?.querySelector<HTMLElement>('.quest-card-heading h3') ?? questCard.current)
    }
  }, [isQuestOpen, openedRequest])
  const authClient = useMemo(() => providedClient ?? createFirebaseAuthClient(), [providedClient])
  const auth = useSyncExternalStore(authClient.subscribe, authClient.getSnapshot, authClient.getSnapshot)
  const source = readDataSource(import.meta.env.VITE_QUEST_DATA_SOURCE, import.meta.env.DEV)
  const teamPreview = apiMode && apiDataMode === 'team-preview'
  const teamAnswerTrial = teamPreview && teamAnswerTrialProp
  const railFallback = teamPreview ? catalogFallback : undefined
  const getHint = providedGetHint ?? (source === 'preview' && !apiMode && !externalQuest && !catalogFallback ? getPreviewHint : undefined)
  const localApiMode = apiMode || source === 'local-api'
  const durableLocal = apiMode && apiDataMode === 'durable-local'
  const wideViewport = useWideViewport()
  // PC幅では、地図の下に通常フローで出ていたレール（問題の選択・詳細・注意書き）を左サイドバーの
  // パネル内へ寄せ、探索画面を「サイドバー＋地図」だけで完結させる（D-34 の集約の仕上げ）。
  const panelArrangement = wideViewport && (teamPreview || durableLocal)
  const showRecords = localApiMode && recordsOpen
  const api = useMemo(() => providedApi ?? createApiClient({ getIdToken: () => authClient.getIdToken(),
    expectedDataMode: localApiMode ? apiDataMode : undefined }), [providedApi, authClient, localApiMode, apiDataMode])
  const connection = useQuestConnection(apiMode || externalQuest || catalogFallback ? 'preview' : source, api)
  const content = connection.result.status === 'ready' ? connection.result.value : null
  const quest = externalQuest ?? (!apiMode && !catalogFallback && content ? (({ areaLabel: _area, ...dto }) => dto)(content) : null)
  const areaLabel = externalAreaLabel ?? content?.areaLabel ?? demoAreaLabel
  // PC（広い画面）では挑戦の主導線をスマホへ受け渡す。その問題の詳細を直接開くURLをQRにする。
  const handoffUrl = useMemo(() => {
    if (!quest) return undefined
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('area', quest.areaId)
      url.searchParams.set('quest', quest.questId)
      url.hash = ''
      return url.toString()
    } catch { return undefined }
  }, [quest])
  // ディープリンク（?quest=）で開かれた場合は、その問題の詳細を最初から開く。
  const [initialQuestParam] = useState(() => { try { return new URLSearchParams(window.location.search).get('quest') ?? '' } catch { return '' } })
  const [deepLinkOpenedFor, setDeepLinkOpenedFor] = useState('')
  if (!externalQuest && initialQuestParam && quest && quest.questId === initialQuestParam && deepLinkOpenedFor !== initialQuestParam) {
    setDeepLinkOpenedFor(initialQuestParam)
    setOpenState({ quest: externalQuest, open: true })
  }
  const questKey = quest ? `${quest.questId}:${quest.version}` : ''
  const [localStaleQuestKey, setLocalStaleQuestKey] = useState('')
  const questStale = providedQuestStale || (questKey !== '' && localStaleQuestKey === questKey)
  const serverIdentity = useServerIdentity((!teamPreview || teamAnswerTrial) && (apiMode || source === 'local-api'), api, auth)
  // 自治体画面への入口は、所属を持つアカウントでログインした時だけ出す（表示の制御であり、保護はサーバー側）。
  const hasAdminMembership = useAdminMembership(teamPreview, api, auth)
  const identityErrorMessage = teamAnswerTrial && serverIdentity.result?.status === 'error' && serverIdentity.result.code === 'FORBIDDEN'
    ? 'この回答試験は招待された人だけが使えます。このアカウントは招待されていません。'
    : 'ログインを確認できませんでした。時間をおいて再試行してください。'
  const uid = auth.status === 'signed-in' ? auth.user.uid : null
  const canUseCamera = uid !== null && (!(apiMode || source === 'local-api') || serverIdentity.result?.status === 'ready')
  const [cameraOwner, setCameraOwner] = useState<{ auth: AuthSnapshot; confirmation: typeof serverIdentity.result; questId: string; version: number } | null>(null)
  const [captureRevision, setCaptureRevision] = useState(0)
  const closeCamera = useCallback(() => { setCameraOwner(null); setCaptureRevision((value) => value + 1) }, [])
  const cameraVisible = !questStale && canUseCamera && cameraOwner !== null && cameraOwner.auth === auth && cameraOwner.confirmation === serverIdentity.result && cameraOwner.questId === quest?.questId && cameraOwner.version === quest.version
  // アカウントメニューを開いた時点の uid を持ち、ログイン状態が変われば開いていないものとして扱う（派生）。
  const [accountMenuAnchor, setAccountMenuAnchor] = useState<string | null>(null)
  const accountMenuOpen = accountMenuAnchor !== null && auth.status === 'signed-in' && accountMenuAnchor === auth.user.uid
  const accountMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!accountMenuOpen) return
    const closeOnOutside = (event: PointerEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) setAccountMenuAnchor(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAccountMenuAnchor(null) }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [accountMenuOpen])
  const [pending, setPending] = useState<{ client: AuthClient; kind: 'sign-in' | 'sign-out' } | null>(null)
  const pendingRef = useRef(false)
  const lifecycle = useRef(0)
  const selectionGeneration = useRef(0)
  const waitController = useRef<AbortController | null>(null)
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null)
  const [startIntent, setStartIntent] = useState<{ auth: AuthSnapshot; selection: ChallengeSelection; generation: number; expires: number } | null>(null)
  const selectedQuest = useRef(quest)
  const openRef = useRef(isQuestOpen)
  const visiblePending = pending?.client === authClient ? pending.kind : null
  const notice = connectionNotice(auth, durableLocal || teamPreview)

  useLayoutEffect(() => {
    if (selectedQuest.current?.questId !== quest?.questId || selectedQuest.current?.version !== quest?.version) {
      selectionGeneration.current += 1
    }
    selectedQuest.current = quest
    openRef.current = isQuestOpen
  }, [quest, isQuestOpen])

  useEffect(() => {
    pendingRef.current = false
    return () => {
      lifecycle.current += 1
      waitController.current?.abort()
    }
  }, [authClient])

  async function login(selection?: ChallengeSelection) {
    if ((selection && questStale) || visiblePending || pendingRef.current) return
    const requestedAt = Date.now()
    const operation = lifecycle.current
    const generation = selectionGeneration.current
    setFeedback(null)
    if (auth.status === 'signed-in') {
      if (!onStartChallenge || !selection) return
      pendingRef.current = true
      setPending({ client: authClient, kind: 'sign-in' })
      try { await onStartChallenge(selection) }
      catch { if (lifecycle.current === operation) setFeedback({ error: true, text: '挑戦を開始できませんでした。問題の閲覧を続けられます。' }) }
      finally { if (lifecycle.current === operation) { pendingRef.current = false; setPending(null) } }
      return
    }
    if (auth.status !== 'signed-out') return
    pendingRef.current = true
    setPending({ client: authClient, kind: 'sign-in' })
    const controller = new AbortController()
    waitController.current = controller
    let firstUid: string | null = null
    let accountChanged = false
    const stopObserving = authClient.subscribe(() => {
      const next = authClient.getSnapshot()
      if (next.status === 'signed-in') {
        if (firstUid !== null && firstUid !== next.user.uid) accountChanged = true
        firstUid ??= next.user.uid
      } else if (firstUid !== null) accountChanged = true
    })
    try {
      await authClient.signInWithGoogle()
      if (lifecycle.current !== operation) return
      const signedIn = await waitForSignedIn(authClient, controller.signal)
      if (!signedIn) {
        if (lifecycle.current === operation) setFeedback({ error: true, text: 'ログイン状態を確認できませんでした。問題の閲覧を続けられます。' })
        return
      }
      if (lifecycle.current !== operation || selectionGeneration.current !== generation) return
      if (durableLocal && !accountChanged && !onStartChallenge && selection && openRef.current &&
        selectedQuest.current?.questId === selection.questId && selectedQuest.current.version === selection.expectedVersion && Date.now() - requestedAt < 30_000) {
        setStartIntent({ auth: authClient.getSnapshot(), selection, generation, expires: requestedAt + 30_000 })
      }
      if (selection && openRef.current && selectedQuest.current?.questId === selection.questId &&
        selectedQuest.current?.version === selection.expectedVersion && onStartChallenge) await onStartChallenge(selection)
    }
    catch (error) {
      const safe = error instanceof AuthError ? error : new AuthError('unknown')
      if (lifecycle.current === operation) setFeedback({ error: safe.code !== 'cancelled', text: safe.message })
    } finally {
      stopObserving()
      if (waitController.current === controller) waitController.current = null
      if (lifecycle.current === operation) { pendingRef.current = false; setPending(null) }
    }
  }

  useEffect(() => {
    if (!startIntent) return
    const timer = setTimeout(() => setStartIntent(null), Math.max(0, startIntent.expires - Date.now()))
    const cancel = () => setStartIntent(null)
    window.addEventListener('pagehide', cancel)
    return () => { clearTimeout(timer); window.removeEventListener('pagehide', cancel) }
  }, [startIntent])

  async function logout() {
    if (visiblePending) return
    closeCamera()
    setFeedback(null)
    setPending({ client: authClient, kind: 'sign-out' })
    try { await authClient.signOut() }
    catch (error) {
      const safe = error instanceof AuthError ? error : new AuthError('unknown')
      setFeedback({ error: true, text: safe.message })
    } finally { setPending(null) }
  }

  function navigateToRecords(open: boolean) {
    if (!open) setRecordDestination(null)
    closeCamera()
    selectionGeneration.current++
    setFeedback(null)
    setRecordsOpen(open)
  }

  const exploreFeedback = !isQuestOpen && feedback
    ? <p className="auth-feedback" role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p> : null
  // 詳細は、地図が使える表示（共有検証・永続）では一覧の選択中の行の直下へアコーディオンとして
  // 差し込む（D-46）。対象の問題が一覧に無い使い方（固定問題の埋め込み等）と、それ以外
  // （スタンドアロンのデモ表示等）では従来どおりレールに置く。
  const detailInList = (teamPreview || durableLocal) && Boolean(quest) && mapQuests.some((item) => item.questId === quest?.questId)
  const questDetailBlock = (
              !railFallback && <div ref={questCard}>
                {quest ? <QuestDetails quest={quest} areaLabel={areaLabel} sourceLabel={teamPreview ? '共有検証用の問題' : apiMode ? '公開APIデモデータ' : undefined} open={isQuestOpen} handoffUrl={handoffUrl}
                  getHint={getHint ?? api.getHint} getHintPhoto={teamPreview ? api.getPublishedHintPhoto : undefined} stale={questStale}
                  onHintVersionChanged={() => { closeCamera(); selectionGeneration.current++; waitController.current?.abort(); setLocalStaleQuestKey(questKey); onHintVersionStale?.() }}
                  onReloadQuest={(event) => { if (externalQuest) onReloadQuest?.(event); else connection.retry() }}
                  hideStartAction={(teamPreview && !teamAnswerTrial) || (!onStartChallenge && (apiMode || source === 'local-api') && canUseCamera && visiblePending === null)}
                  disabled={questStale || visiblePending !== null || (auth.status !== 'signed-out' && auth.status !== 'signed-in') || (auth.status === 'signed-in' && (onStartChallenge ? false : !canUseCamera || cameraVisible))}
                  buttonLabel={visiblePending === 'sign-in' ? '処理中…' : auth.status === 'signed-in' ? (onStartChallenge ? '挑戦を開始する' : cameraVisible ? '撮影中' : serverIdentity.result?.status === 'loading' ? 'ログインの確認中…' : serverIdentity.result?.status === 'error' ? 'ログインの確認待ち' : '撮影を始める') : 'Googleログインして挑戦する'}
                  note={questStale ? '問題の版を確認できていません。最新版を読み直すまで挑戦できません。'
                    : auth.status === 'signed-in' && !onStartChallenge ? serverIdentity.result?.status === 'ready' ? 'ログインを確認しました。写真はこの画面で確認するだけです。' : serverIdentity.result?.status === 'loading' ? 'ログインを確認しています…' : '問題の閲覧は続けられます。ログイン確認後に撮影できます。'
                    : auth.status === 'signed-in' ? 'ログイン済みです。挑戦開始先へ選んだ問題を渡します。'
                      : auth.status === 'signed-out' ? 'Googleのログイン画面を開きます。キャンセルしてもこの問題に戻れます。'
                        : auth.status === 'checking' ? 'ログイン状態の確認後に操作できます。'
                          : 'ログイン機能は準備中です。問題はそのまま閲覧できます。'}
                  feedback={feedback} onToggle={() => { const next = !openRef.current; selectionGeneration.current += 1; openRef.current = next; if (!next) closeCamera(); setOpenState({ quest: externalQuest, open: next }) }} onStart={(selection) => { if (onStartChallenge) return login(selection); if (auth.status === 'signed-in' && canUseCamera && quest) setCameraOwner({ auth, confirmation: serverIdentity.result, questId: selection.questId, version: selection.expectedVersion }); else return login(selection) }}>
                    {!questStale && !onStartChallenge && (apiMode || source === 'local-api') && canUseCamera && uid !== null && visiblePending === null && <ChallengeCapture
                      key={JSON.stringify([uid, quest.questId, quest.version, captureRevision])} api={api} quest={quest} dataMode={apiDataMode}
                      autoStart={durableLocal && startIntent !== null && startIntent.auth === auth && startIntent.selection.questId === quest.questId && startIntent.selection.expectedVersion === quest.version}
                      canAutoStart={() => startIntent !== null && startIntent.generation === selectionGeneration.current && startIntent.expires > Date.now() && openRef.current && authClient.getSnapshot() === startIntent.auth}
                      onAutoStartConsumed={() => setStartIntent(null)}
                      onOpenDiscovery={durableLocal ? (id) => { setRecordDestination({ auth, id }); navigateToRecords(true) } : undefined}
                      onReloadQuest={() => { closeCamera(); if (externalQuest) onReloadQuest?.(); else connection.retry() }} />}
                    {auth.status === 'signed-in' && serverIdentity.result?.status === 'error' && <div className="auth-feedback"><p role="alert">{identityErrorMessage}</p><button type="button" className="retry-button" onClick={serverIdentity.retry}>ログインを確認し直す</button></div>}
                    {cameraVisible && uid !== null && <CameraPreview key={uid} onClose={closeCamera} />}
                    {localApiMode && !teamPreview && <QuestReport key={questKey} api={api} questId={quest.questId} dataMode={apiDataMode}
                      ownerUid={canUseCamera && visiblePending === null ? uid : null} canSignIn={auth.status === 'signed-out'}
                      signInPending={visiblePending !== null} onSignIn={() => void login()} />}
                  </QuestDetails>
                  : apiMode ? null : connection.result.status === 'loading' ? <p role="status" aria-label="問題の読み込み">問題を読み込んでいます…</p> : <div role="alert">{source === 'invalid' ? '表示設定を確認してください。' : '問題を読み込めませんでした。'}<button type="button" className="retry-button" onClick={connection.retry}>問題を再読み込み</button></div>}
              </div>
  )
  const railContent = (
    <>
              {railFallback ?? questPicker}
              {!detailInList && questDetailBlock}
              {/* 共有検証（team-preview）ではデモの断り書きを出さない（D-39）。永続・公開APIデモでは、
                  合成画像・架空座標の使用や「実際に訪問できる場所ではない」という制限の明示として残す。 */}
              {!teamPreview && <div className="demo-note"><span className="demo-note-dot" /><p>{durableLocal ? '永続APIの確認用です。回答の送信には合成画像と架空の座標を使ってください。' : apiMode ? '公開APIが返す架空のデモデータです。実際に訪問できる場所ではありません。' : '今はデザイン確認用の架空の1問を表示しています。実際に訪問できる場所ではありません。'}</p></div>}
    </>
  )
  // サイドバー内では、レールの中身と認証フィードバックをパネルに寄せる。
  const panelContent = (
    <div className="side-panel-rail">
      {railContent}
      {exploreFeedback}
    </div>
  )

  return (
    <>
      <a className="skip-link" href="#main">本文へ移動</a>
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark"><Icon name="compass" /></span>
          <span className="brand-copy">全国観光謎アプリ</span>
        </div>
        <nav className="desktop-nav" aria-label="主要ナビゲーション">
          <a className={showRecords ? undefined : 'nav-active'} href="#explore-title" aria-current={showRecords ? undefined : 'page'}
            onClick={() => navigateToRecords(false)}><Icon name="map" />謎を探す</a>
          {(!teamPreview || teamAnswerTrial) && <button type="button" className={showRecords ? 'nav-active' : undefined} aria-current={showRecords ? 'page' : undefined}
            disabled={!localApiMode || visiblePending !== null} onClick={() => navigateToRecords(true)}>
            <Icon name="book" />自分の記録{!localApiMode && <span>準備中</span>}
          </button>}
        </nav>
        <div className="account-area">
          {/* 右上の固定スロットはアイコン型にする（#36 の固定スロットと、#42 の「状態表示を置かない」を維持）。
              ログイン中はタップで小さなメニューを開き、アカウント名とログアウトはその中だけに出す。 */}
          {auth.status === 'signed-in' ? (
            <div className="account-menu-wrap" ref={accountMenuRef}>
              <button type="button" className="account-icon-button" aria-label="アカウントメニュー" aria-haspopup="menu"
                aria-expanded={accountMenuOpen} disabled={visiblePending !== null}
                onClick={() => setAccountMenuAnchor((anchor) => (anchor === auth.user.uid ? null : auth.user.uid))}>
                {auth.user.photoURL
                  ? <img src={auth.user.photoURL} alt="" />
                  : auth.user.displayName
                    ? <span className="account-initial" aria-hidden="true">{auth.user.displayName.slice(0, 1)}</span>
                    : <Icon name="user" />}
              </button>
              {accountMenuOpen && (
                <div className="account-menu" role="menu">
                  <p className="account-menu-name">{auth.user.displayName ?? 'ログイン中のアカウント'}</p>
                  {/* 自治体画面への入口はアカウントメニューの中だけに置き、ナビ／タブは全ユーザー共通にする（D-47）。 */}
                  {teamPreview && hasAdminMembership && <a role="menuitem" href="/admin">自治体画面</a>}
                  <button type="button" role="menuitem" onClick={() => { setAccountMenuAnchor(null); void logout() }}>ログアウト</button>
                </div>
              )}
            </div>
          ) : (
            <button type="button" className="account-icon-button" aria-label="ログイン"
              disabled={visiblePending !== null || auth.status !== 'signed-out'} onClick={() => void login()}>
              <Icon name="user" />
            </button>
          )}
        </div>
      </header>

      <main id="main" className="page" tabIndex={-1}>
        {showRecords ? <section className="owner-records view-enter" aria-labelledby="records-title">
          <h1 id="records-title">自分の記録</h1>
          <p className="sample-note">開発用の本人記録です。</p>
          <button type="button" className="secondary-button" onClick={() => navigateToRecords(false)}>地図へ戻る</button>
          {auth.status === 'signed-out' && <button type="button" className="primary-button" disabled={visiblePending !== null}
            onClick={() => void login()}>Googleログインして記録を見る</button>}
          {auth.status === 'checking' && <p role="status">ログイン状態を確認しています…</p>}
          {(auth.status === 'unconfigured' || auth.status === 'unavailable') && <p role="status">{notice.description}</p>}
          {uid !== null && visiblePending === null && (serverIdentity.result?.status === 'ready'
            ? <OwnerDiscoveries key={uid} api={api} initialId={recordDestination?.auth === auth ? recordDestination.id : undefined} />
            : serverIdentity.result?.status === 'error'
              ? <><p role="alert">ログインを確認できませんでした。</p><button type="button" className="retry-button" onClick={serverIdentity.retry}>ログインを確認し直す</button></>
              : <p role="status">ログインを確認しています…</p>)}
          {feedback && <p className="auth-feedback" role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
        </section> : (!teamPreview ? catalogFallback : undefined) ?? <>
        <section className="explore view-enter" aria-labelledby="explore-title">
          <div className="explore-heading">
            <div>
              <h1 id="explore-title">全国から謎を探す</h1>
            </div>
            <span className={'preview-label' + (apiMode ? ' api-source' : '')}><span className="status-dot" />{teamPreview ? 'チーム共有検証' : durableLocal ? '永続API・ローカル' : apiMode ? '公開API・デモ' : '開発用プレビュー'}</span>
          </div>

          <div className="explore-workspace">
            <MapPreview areas={mapAreas} selectedAreaId={selectedAreaId} onSelectArea={onSelectArea} showPublicAreas={durableLocal || teamPreview} quests={mapQuests} onOpenQuest={onOpenQuest} selectedQuestId={quest?.questId ?? ''} topOverlay={mapOverlay} showBoundaryCredit={teamPreview} fillSelectedAreaOnly={teamPreview} panelExtra={panelArrangement ? panelContent : undefined} onSheetModeChange={onMapSheetModeChange} questScrollTarget={questCard} questDetail={detailInList ? questDetailBlock : undefined} />

{!panelArrangement && <aside className="quest-rail" aria-label="選べる謎">{railContent}</aside>}
          </div>
        </section>
        {!panelArrangement && exploreFeedback}
        </>}
      </main>
      <nav className="mobile-nav" aria-label="スマホ用ナビゲーション">
        <a href="#explore-title" aria-current={showRecords ? undefined : 'page'} onClick={() => navigateToRecords(false)}><Icon name="map" /><span>謎を探す</span></a>
        {(!teamPreview || teamAnswerTrial) && <button type="button" aria-current={showRecords ? 'page' : undefined} disabled={!localApiMode || visiblePending !== null}
          onClick={() => navigateToRecords(true)}><Icon name="book" /><span>自分の記録{!localApiMode && <small>準備中</small>}</span></button>}
      </nav>
    </>
  )
}
