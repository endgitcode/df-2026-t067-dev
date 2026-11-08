import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import App from '../../App'
import type { AuthClient } from '../auth/authTypes'
import { ApiError, createApiClient } from '../../shared/api/client'
import type { LocalApiDataMode } from '../../shared/api/client'
import type { Page, PublicArea, PublicQuest } from '../../shared/api/types'
import { getRegionAreas, REGIONS } from './areaHierarchy'

type Api = Pick<ReturnType<typeof createApiClient>, 'listQuests' | 'getQuest' | 'listAreas' | 'getHint'>
const emptyAreas: PublicArea[] = []
type Result = {
  api: Api; selection: string; areaSelection: string; retry: number
  state: 'loading' | 'ready' | 'empty' | 'error'
  choices: PublicQuest[]; areas: PublicArea[]; quest?: PublicQuest; area?: PublicArea; missing?: boolean
}
type RefreshSnapshot = { api: Api; questId: string; version: number }

function readSelectionFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return { areaId: params.get('area') ?? '', questId: params.get('quest') ?? '' }
}

function writeSelectionToUrl(areaId: string, questId: string, mode: 'push' | 'replace') {
  const url = new URL(window.location.href)
  if (areaId) url.searchParams.set('area', areaId)
  else url.searchParams.delete('area')
  if (questId) url.searchParams.set('quest', questId)
  else url.searchParams.delete('quest')
  window.history[mode === 'push' ? 'pushState' : 'replaceState'](window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

async function readPages<T>(read: (cursor?: string) => Promise<Page<T>>, signal: AbortSignal) {
  const items: T[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  do {
    signal.throwIfAborted()
    const page = await read(cursor)
    signal.throwIfAborted()
    items.push(...page.items)
    cursor = page.nextCursor ?? undefined
    if (cursor && seen.has(cursor)) throw new Error('Repeated pagination cursor')
    if (cursor) seen.add(cursor)
  } while (cursor)
  return items
}

export function ApiQuestApp({ api: providedApi, syncUrl = true, authClient, dataMode = 'demo', teamAnswerTrial = false }: {
  api?: Api; syncUrl?: boolean; authClient?: AuthClient; dataMode?: LocalApiDataMode; teamAnswerTrial?: boolean
}) {
  const api = useMemo(() => providedApi ?? createApiClient({ expectedDataMode: dataMode }), [providedApi, dataMode])
  const [initialSelection] = useState(() => syncUrl ? readSelectionFromUrl() : { areaId: '', questId: '' })
  // URLで問題が指定されて開かれた場合（QRのディープリンク等）は、読み込み後にその問題の詳細を開く。
  const [openQuestRequest, setOpenQuestRequest] = useState<{ questId: string; sequence: number } | undefined>(
    () => initialSelection.questId ? { questId: initialSelection.questId, sequence: 1 } : undefined)
  const [selectedId, setSelectedId] = useState(initialSelection.questId)
  const [selectedAreaId, setSelectedAreaId] = useState(initialSelection.areaId)
  const [activeRegion, setActiveRegion] = useState('')
  const [activePrefecture, setActivePrefecture] = useState('')
  const [retry, setRetry] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNotice, setRefreshNotice] = useState<{ api: Api; text: string } | null>(null)
  const refreshSnapshot = useRef<RefreshSnapshot | null>(null)
  const refreshingRetry = useRef(-1)
  const refreshInFlight = useRef(false)
  const refreshOperation = useRef(0)
  const loadGeneration = useRef(0)
  const refreshButton = useRef<HTMLButtonElement>(null)
  const restoreRefreshFocus = useRef(false)
  const [staleQuest, setStaleQuest] = useState<{ questId: string; version: number } | null>(null)
  // 地図が使える表示（シート／パネル表示）かどうかは MapPreview から受け取る。使える間は
  // 問題の選択を地図連動のカード一覧とピンに一本化し、全件ピッカーと「公開情報を更新」は
  // 地図が使えないフォールバック表示でのみ出す（D-43）。再取得の仕組み自体は変えない。
  const [mapSheetMode, setMapSheetMode] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const catalog = useRef<{ api: Api; choices: Map<string, PublicQuest[]>; areas?: PublicArea[] } | null>(null)
  const clearRefreshNotice = () => {
    setRefreshNotice(null)
    refreshOperation.current += 1
    refreshSnapshot.current = null
    refreshInFlight.current = false
    restoreRefreshFocus.current = false
    setRefreshing(false)
  }

  useEffect(() => {
    if (!syncUrl) return
    const onPopState = () => {
      clearRefreshNotice()
      const selection = readSelectionFromUrl()
      // History stores the selected area and quest, so clear transient filters.
      setActiveRegion('')
      setActivePrefecture('')
      setSelectedAreaId(selection.areaId)
      setSelectedId(selection.questId)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [syncUrl])

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    const operation = refreshOperation.current
    const generation = ++loadGeneration.current
    let choices: PublicQuest[] = []
    let settled = false
    const fail = (error?: unknown) => {
      settled = true
      setResult({ api, selection: selectedId, areaSelection: selectedAreaId, retry, state: 'error', choices,
        areas: catalog.current?.api === api ? catalog.current.areas ?? [] : [],
        missing: error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'QUEST_UNAVAILABLE') })
    }
    const deadline = setTimeout(() => {
      fail()
      controller.abort()
      if (refreshingRetry.current === retry && refreshOperation.current === operation && loadGeneration.current === generation) {
        refreshInFlight.current = false
        setRefreshing(false)
      }
    }, 10_000)
    // Discard obsolete responses even when a transport ignores cancellation.
    void (async () => {
      try {
        let cache = catalog.current?.api === api ? catalog.current : undefined
        if (!cache) {
          cache = { api, choices: new Map() }
          catalog.current = cache
        }
        let areas = cache.areas
        if (!areas) {
          areas = await readPages((cursor) => api.listAreas({ limit: 100, cursor }, { signal }), signal)
          if (signal.aborted) return
          cache.areas = areas
        }
        choices = cache.choices.get(selectedAreaId) ?? []
        if (!cache.choices.has(selectedAreaId)) {
          choices = await readPages((cursor) => api.listQuests({ ...(selectedAreaId ? { areaId: selectedAreaId } : {}), limit: 100, cursor }, { signal }), signal)
          if (signal.aborted) return
          cache.choices.set(selectedAreaId, choices)
        }
        if (signal.aborted) return
        if (!choices.length) {
          if (selectedId) {
            if (syncUrl) writeSelectionToUrl(selectedAreaId, '', 'replace')
            setSelectedId('')
            return
          }
          settled = true
          setResult({ api, selection: selectedId, areaSelection: selectedAreaId, retry, state: 'empty', choices, areas })
          return
        }
        setResult({ api, selection: selectedId, areaSelection: selectedAreaId, retry, state: 'loading', choices, areas })
        const id = choices.some((item) => item.questId === selectedId) ? selectedId : choices[0].questId
        if (id !== selectedId) {
          if (syncUrl) writeSelectionToUrl(selectedAreaId, id, 'replace')
          setSelectedId(id)
          return
        }
        const quest = await api.getQuest(id, { signal })
        signal.throwIfAborted()
        if (quest.questId !== id) throw new ApiError('INVALID_RESPONSE')
        if (selectedAreaId && quest.areaId !== selectedAreaId) throw new ApiError('INVALID_RESPONSE')
        settled = true
        setResult({ api, selection: selectedId, areaSelection: selectedAreaId, retry, state: 'ready', choices, areas, quest,
          area: areas.find((item) => item.areaId === quest.areaId) })
        if (refreshingRetry.current === retry && refreshOperation.current === operation) {
          const snapshot = refreshSnapshot.current
          if (snapshot?.api === api && snapshot.questId !== quest.questId) {
            setRefreshNotice({ api, text: '更新により選択中の問題が公開一覧からなくなったため、別の問題を表示しています。' })
          } else if (snapshot?.api === api && snapshot.questId === quest.questId && snapshot.version !== quest.version) {
            setRefreshNotice({ api, text: '問題が更新されました。詳細を開いて内容をご確認ください。' })
          }
        }
      } catch (error) {
        if (!signal.aborted) fail(error)
      } finally {
        clearTimeout(deadline)
        if (settled && refreshingRetry.current === retry && refreshOperation.current === operation && loadGeneration.current === generation) {
          refreshInFlight.current = false
          setRefreshing(false)
        }
      }
    })()
    return () => { clearTimeout(deadline); controller.abort() }
  }, [api, selectedId, selectedAreaId, retry, syncUrl])

  const current = result?.api === api && result.selection === selectedId && result.areaSelection === selectedAreaId && result.retry === retry ? result : null
  const state = current?.state ?? 'loading'
  const choices = current?.choices ?? []
  const availableAreas = result?.api === api ? result.areas : emptyAreas
  const regionAreas = useMemo(() => getRegionAreas(availableAreas, activeRegion, activePrefecture), [availableAreas, activeRegion, activePrefecture])
  const prefOptions = REGIONS.find((item) => item.name === activeRegion)?.prefectures ?? []
  const resetAreaSelection = () => {
    if (!selectedAreaId) return
    clearRefreshNotice()
    if (syncUrl) writeSelectionToUrl('', '', 'push')
    setSelectedAreaId('')
    setSelectedId('')
  }

  const visibleAreaIds = useMemo(() => new Set(regionAreas.map((area) => area.areaId)), [regionAreas])
  const visibleChoices = activeRegion ? choices.filter((item) => visibleAreaIds.has(item.areaId)) : choices
  const selectedQuestId = visibleChoices.some((item) => item.questId === selectedId)
    ? selectedId
    : activeRegion ? '' : visibleChoices[0]?.questId ?? ''
  const selectRegion = (region: string) => { setActiveRegion(region); setActivePrefecture(''); resetAreaSelection() }
  const selectPrefecture = (prefecture: string) => { setActivePrefecture(prefecture); resetAreaSelection() }
  // 地方・都道府県の絞り込みは地図の上に浮くチップで出す（フォールバック表示では通常フローに置く）。
  // 「全国」チップは置かず、未選択（初期状態）が全国表示。選択中の地方チップをもう一度押すと解除される。
  // 地方を解除・変更すると都道府県の選択も外れる（従来どおり selectRegion が都道府県をリセットする）。
  const filterControls = <div className="map-filter-panel">
    <div className="map-filter-chips" role="group" aria-label="地方">
      {REGIONS.map((region) => <button key={region.name} type="button" className="filter-chip" aria-pressed={activeRegion === region.name} onClick={() => selectRegion(activeRegion === region.name ? '' : region.name)}>{region.name}</button>)}
    </div>
    {activeRegion && <div className="map-filter-chips" role="group" aria-label="都道府県">
      <button type="button" className="filter-chip" aria-pressed={activePrefecture === ''} onClick={() => selectPrefecture('')}>地方内すべて</button>
      {prefOptions.map((prefecture) => <button key={prefecture} type="button" className="filter-chip" aria-pressed={activePrefecture === prefecture} onClick={() => selectPrefecture(prefecture)}>{prefecture}</button>)}
    </div>}
  </div>
  // 問題の選択は全モード共通で「リストの項目を押す」形に統一する（ドロップダウンは置かない）。
  // 地図のカードと同じく、押した問題の詳細を開くところまでを担う。
  const chooseQuest = (item: PublicQuest) => {
    if (dataMode === 'team-preview') {
      openQuestFromMap(item.questId)
      return
    }
    clearRefreshNotice()
    if (syncUrl) writeSelectionToUrl(selectedAreaId, item.questId, 'push')
    setSelectedId(item.questId)
    if (dataMode === 'durable-local') {
      setOpenQuestRequest((previous) => ({ questId: item.questId, sequence: (previous?.sequence ?? 0) + 1 }))
    }
  }
  const picker = <div className="api-quest-picker">
    {activeRegion && state !== 'loading' && state !== 'error' && !selectedQuestId && <p role="status">{visibleChoices.length ? '一覧から問題を選んでください。' : 'この条件に公開問題はありません。'}</p>}
    <ul aria-label="公開問題">{visibleChoices.map((item) => <li key={item.questId}>
      <button type="button" aria-label={`${item.title}を開く`} aria-pressed={item.questId === selectedQuestId} onClick={() => chooseQuest(item)}>{item.title}</button>
    </li>)}</ul>
  </div>

  const quest = state === 'ready' ? current?.quest : undefined
  const reload = (event?: MouseEvent<HTMLButtonElement>) => {
    if (refreshInFlight.current) return
    refreshInFlight.current = true
    refreshOperation.current += 1
    restoreRefreshFocus.current = !!event && document.activeElement === event.currentTarget
    setRefreshNotice(null)
    const shownQuest = current?.state === 'ready' ? current.quest : undefined
    refreshSnapshot.current = shownQuest ? { api, questId: shownQuest.questId, version: shownQuest.version } : null
    setRefreshing(true)
    refreshingRetry.current = retry + 1
    catalog.current = null
    setRetry((value) => value + 1)
  }
  useEffect(() => {
    if (refreshing || !restoreRefreshFocus.current) return
    restoreRefreshFocus.current = false
    if (document.activeElement === document.body) refreshButton.current?.focus()
  }, [refreshing])
  const refreshControl = <>
    <button ref={refreshButton} type="button" onClick={reload} disabled={refreshing}>
      {refreshing ? '公開情報を更新中…' : '公開情報を更新'}
    </button>
    {refreshing && <span role="status">地域・問題一覧・選択中の詳細を取り直しています。</span>}
    {refreshNotice?.api === api && <span role="status">{refreshNotice.text}</span>}
  </>
  const selectArea = (areaId: string) => {
    // 選択中の地域がもう一度選ばれたら（ピンの再タップ等）選択を解除し、未選択＝全件表示に戻る。
    if (areaId === selectedAreaId) { resetAreaSelection(); return }
    if (!regionAreas.some((item) => item.areaId === areaId)) return
    clearRefreshNotice()
    if (syncUrl) writeSelectionToUrl(areaId, '', 'push')
    setSelectedAreaId(areaId)
    setSelectedId('')
  }
  function openQuestFromMap(questId: string) {
    const target = visibleChoices.find((item) => item.questId === questId)
    if (!target) return
    clearRefreshNotice()
    if (syncUrl) writeSelectionToUrl(target.areaId, questId, 'push')
    if (target.areaId !== selectedAreaId) setSelectedAreaId(target.areaId)
    setSelectedId(questId)
    setOpenQuestRequest((previous) => ({ questId, sequence: (previous?.sequence ?? 0) + 1 }))
  }
  const FallbackHeading = dataMode === 'team-preview' ? 'h2' : 'h1'
  const fallback = !quest ? <section className="api-load-state" aria-live="polite">
      {dataMode !== 'team-preview' && <p className="eyebrow">{dataMode === 'durable-local' ? '永続API・ローカル' : '公開APIデモ'}</p>}
      <FallbackHeading id={dataMode === 'team-preview' ? undefined : 'explore-title'}>{state === 'loading' ? '公開問題を読み込み中' : state === 'empty' ? '公開問題はありません' : '公開問題を取得できませんでした'}</FallbackHeading>
      {state === 'loading' && <p role="status">サーバーから問題を取得しています。</p>}
      {state === 'empty' && <p>{selectedAreaId ? 'この地域に公開問題はありません。地図や地方の絞り込みから別の地域をお選びください。' : '現在選べる公開問題はありません。'}</p>}
      {state === 'error' && <p role="alert">{current?.missing
        ? 'この問題は公開されていないか、見つかりません。別の問題を選べます。'
        : 'サーバーとの通信を確認して、もう一度お試しください。'}</p>}
      {state !== 'loading' && <button type="button" onClick={(event) => reload(event)} disabled={refreshing}>再試行</button>}
      {!mapSheetMode && refreshControl}
      {(availableAreas.length > 0 || choices.length > 0 || state === 'empty' || state === 'error') && <>{dataMode !== 'team-preview' && filterControls}{!mapSheetMode && picker}</>}
    </section> : undefined
  return <App openQuestRequest={openQuestRequest} authClient={authClient} quest={quest && (!activeRegion || visibleAreaIds.has(quest.areaId)) ? quest : undefined} mapAreas={regionAreas} mapQuests={visibleChoices} onOpenQuest={openQuestFromMap} selectedAreaId={selectedAreaId} onSelectArea={selectArea}
    areaLabel={current?.area?.label ?? '探索地域名は未掲載です'}
    questPicker={mapSheetMode ? undefined : <>{picker}{refreshControl}</>} catalogFallback={fallback} mapOverlay={filterControls} onMapSheetModeChange={setMapSheetMode} apiMode apiDataMode={dataMode} teamAnswerTrial={teamAnswerTrial} getHint={api.getHint}
    questStale={!!quest && staleQuest?.questId === quest.questId && staleQuest.version === quest.version}
    onHintVersionStale={() => { if (quest) setStaleQuest({ questId: quest.questId, version: quest.version }) }}
    onReloadQuest={(event) => reload(event)} />
}
