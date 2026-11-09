import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import App from '../../App'
import { Icon } from '../../components/Icon'
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

function questNumberKey(quest: PublicQuest): readonly [number, number] | null {
  const match = quest.questNumber ? /^(\d{1,2})-(\d+)$/.exec(quest.questNumber) : null
  return match ? [Number(match[1]), Number(match[2])] : null
}

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
  const [filterOpen, setFilterOpen] = useState(false)
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

  // 地方・都道府県の絞り込みは履歴に含まれない一時状態。popstate ハンドラからは
  // 最新の絞り込みを ref 経由で読む。
  const filterStateRef = useRef({ region: '', prefecture: '' })
  useEffect(() => { filterStateRef.current = { region: activeRegion, prefecture: activePrefecture } }, [activeRegion, activePrefecture])

  useEffect(() => {
    if (!syncUrl) return
    const onPopState = () => {
      clearRefreshNotice()
      const selection = readSelectionFromUrl()
      setSelectedAreaId(selection.areaId)
      setSelectedId(selection.questId)
      // 絞り込みを無条件に外すと、履歴の往復だけで「絞り込みは全国・地域と問題は
      // 選択中のまま」という食い違いになる。復元された地域が現在の絞り込みの外に
      // ある時だけ、両立しない組み合わせを避けるため絞り込みを外す。
      if (selection.areaId) {
        const areas = catalog.current?.areas
        const { region, prefecture } = filterStateRef.current
        if (areas && region && !getRegionAreas(areas, region, prefecture).some((area) => area.areaId === selection.areaId)) {
          setActiveRegion('')
          setActivePrefecture('')
        }
      }
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
        // ?quest= のみのディープリンクでも、所属地域へ選択は追随させない（D-65）。
        // 問題の選択は地域の選択を伴わず、一覧は現在の絞り込みのまま残る。地図の
        // フィットは MapPreview 側が選択中の問題の所属地域から決める（D-44 の寄せは維持）。
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
        if (!selectedId && !selectedAreaId) {
          // 未選択（パラメータなしの初期表示と、選択解除で戻った状態）：一覧と地域は
          // 出すが、先頭問題を自動では選ばない（D-56）。詳細は取得せず、URL に
          // ?quest= も付けない。地域が選ばれている場合と、問題IDだけが残っている
          // 場合（ディープリンク・履歴復元・再試行で消えた選択の置換）は従来どおり
          // 下の経路で先頭問題へ合わせる。
          settled = true
          setResult({ api, selection: selectedId, areaSelection: selectedAreaId, retry, state: 'ready', choices, areas })
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
    // 問題だけが選択されている状態（D-65）でも、絞り込み変更などでは選択を丸ごと外す。
    if (!selectedAreaId && !selectedId) return
    clearRefreshNotice()
    if (syncUrl) writeSelectionToUrl('', '', 'push')
    setSelectedAreaId('')
    setSelectedId('')
  }
  // 選択中の問題だけを外す（D-65）。地域の選択と「場所で絞る」の絞り込みはそのまま
  // 残し、一覧は現在の絞り込みの結果のまま全件が残る。ただし、所属地域が選択中の
  // 問題（地域選択で先頭問題が自動選択された場合を含む）では、問題だけを外すと
  // 読み込み側が先頭問題へ自動で合わせ直して閉じたことにならないため、ピンの
  // 再タップと同じく地域ごと選択解除する（従来の D-55 の単位をこの場合だけ残す）。
  const deselectQuest = () => {
    if (!selectedId) return
    const selectedChoice = choices.find((item) => item.questId === selectedId)
    if (selectedChoice && selectedChoice.areaId === selectedAreaId) { resetAreaSelection(); return }
    clearRefreshNotice()
    if (syncUrl) writeSelectionToUrl(selectedAreaId, '', 'push')
    setSelectedId('')
  }

  const visibleAreaIds = useMemo(() => new Set(regionAreas.map((area) => area.areaId)), [regionAreas])
  // 一覧の並びは問題番号（都道府県コード→連番）の昇順に統一する（D-59）。API の
  // 返却順は地域の登録順で北から南にも番号順にもなっておらず、見る人に規則性が
  // 伝わらなかった。番号が無い問題は番号付きの後ろに、元の順序のまま置く。
  const visibleChoices = [...(activeRegion ? choices.filter((item) => visibleAreaIds.has(item.areaId)) : choices)]
    .sort((a, b) => {
      const ka = questNumberKey(a); const kb = questNumberKey(b)
      if (ka && kb) return ka[0] - kb[0] || ka[1] - kb[1]
      return ka ? -1 : kb ? 1 : 0
    })
  // 表示上の「選択中の問題」は、実際に選択されている問題だけを指す。一覧の先頭を
  // 勝手に選択扱いすると、URL や詳細に出ている問題と別の問題が選択中として
  // 見えてしまう。先頭問題の自動選択は読み込み側が選択状態と URL を更新して行う。
  const selectedQuestId = visibleChoices.some((item) => item.questId === selectedId) ? selectedId : ''
  const selectRegion = (region: string) => { setActiveRegion(region); setActivePrefecture(''); resetAreaSelection() }
  const selectPrefecture = (prefecture: string) => { setActivePrefecture(prefecture); resetAreaSelection() }
  // 地方・都道府県の絞り込みは「場所で絞る」ボタンの中に畳む（D-48）。常時並べず、ボタンを
  // 押した時だけチップを展開する（PC はパネル内、スマホは地図の上に浮く表示のまま）。
  // ボタンの文言に現在の絞り込み状態を出す。地方・都道府県のどちらを選んでも展開は閉じる。
  // 「全国」「地方内すべて」のチップは置かない（D-55）。何も選んでいない状態がそれぞれ
  // 全国・地方内すべてであり、選択中のチップをもう一度押すと解除される（トグル）。
  // 地方を解除・変更すると都道府県の選択も外れる（従来どおり selectRegion が都道府県をリセットする）。
  // 展開は常時マウントして高さと透明度で開閉する（D-55）。出し入れで一覧がガクッと
  // 押し下げられないよう、開閉はアニメーションさせる。
  const filterSummary = activeRegion ? `場所で絞る：${activeRegion}${activePrefecture ? `・${activePrefecture}` : ''}` : '場所で絞る'
  const filterControls = <div className="map-filter-panel">
    <button type="button" className="filter-toggle" aria-expanded={filterOpen} onClick={() => setFilterOpen((value) => !value)}>{filterSummary}<span className={'filter-toggle-chevron' + (filterOpen ? ' is-open' : '')} aria-hidden="true"><Icon name="chevron" /></span></button>
    <div className={'map-filter-chips-wrap' + (filterOpen ? ' is-open' : '')} aria-hidden={!filterOpen}>
      <div className="map-filter-chips-inner">
        <div className="map-filter-chips" role="group" aria-label="地方">
          {REGIONS.map((region) => <button key={region.name} type="button" className="filter-chip" aria-pressed={activeRegion === region.name} onClick={() => { selectRegion(activeRegion === region.name ? '' : region.name); setFilterOpen(false) }}>{region.name}</button>)}
        </div>
        {activeRegion && <div className="map-filter-chips" role="group" aria-label="都道府県">
          {prefOptions.map((prefecture) => <button key={prefecture} type="button" className="filter-chip" aria-pressed={activePrefecture === prefecture} onClick={() => { selectPrefecture(activePrefecture === prefecture ? '' : prefecture); setFilterOpen(false) }}>{prefecture}</button>)}
        </div>}
      </div>
    </div>
  </div>
  // 問題の選択は全モード共通で「リストの項目を押す」形に統一する（ドロップダウンは置かない）。
  // 地図のカードと同じく、押した問題の詳細を開くところまでを担う。
  const chooseQuest = (item: PublicQuest) => {
    // 選択中の問題をもう一度選んだら選択解除（D-55）。所属地域が選択中の場合は
    // 地域ごと、そうでなければ問題だけを外す（deselectQuest と同じ単位に揃える）。
    // 旧仕様の「問題だけが自動選択されている場合の再タップ＝地域まで含めた選択の
    // 確定」という例外（旧 D-55）は、問題だけの選択が通常の形になったため廃止し、
    // 再タップは常に解除として扱う（D-65）。
    if (item.questId === selectedId) { deselectQuest(); return }
    if (dataMode === 'team-preview') {
      openQuestFromMap(item.questId)
      return
    }
    clearRefreshNotice()
    // 問題の選択は所属地域の選択を伴わない（D-65）。一覧は現在の絞り込みのまま
    // 残り、地図のフィットは MapPreview 側が所属地域から決める（D-44 の寄せは維持）。
    if (syncUrl) writeSelectionToUrl(selectedAreaId, item.questId, 'push')
    setSelectedId(item.questId)
    if (dataMode === 'durable-local') {
      setOpenQuestRequest((previous) => ({ questId: item.questId, sequence: (previous?.sequence ?? 0) + 1 }))
    }
  }
  const picker = <div className="api-quest-picker">
    {activeRegion && state !== 'loading' && state !== 'error' && !selectedQuestId && <p role="status">{visibleChoices.length ? '一覧から問題を選んでください。' : 'この条件に合う問題はありません。'}</p>}
    <ul aria-label="問題一覧">{visibleChoices.map((item) => <li key={item.questId}>
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
    // 選択中の問題がもう一度選ばれたら選択解除（D-55）。一覧の行の再タップは
    // ExploreQuestList 側で onDeselectQuest へ振り分けるため、ここに来るのは
    // シートの覗き見など詳細なしの一覧からの再タップと、ピッカー（chooseQuest）
    // 経由の再タップ。解除の単位は deselectQuest と揃える。
    if (questId === selectedId) { deselectQuest(); return }
    clearRefreshNotice()
    // 問題の選択は所属地域の選択を伴わない（D-65）。URL には問題だけを足し、
    // 一覧は現在の絞り込みのまま残る。地図のフィットは MapPreview 側が選択中の
    // 問題の所属地域から決める（D-44 の寄せは維持）。
    if (syncUrl) writeSelectionToUrl(selectedAreaId, questId, 'push')
    setSelectedId(questId)
    setOpenQuestRequest((previous) => ({ questId, sequence: (previous?.sequence ?? 0) + 1 }))
  }
  const FallbackHeading = dataMode !== 'demo' ? 'h2' : 'h1'
  // 読み込み済みで未選択（D-56）の時はフォールバック枠を出さない。出るのは
  // 読み込み中・0件・エラーの時だけであり、未選択は探索画面の一覧で完結する。
  // 地図が使える表示では読み込み中を一覧のスケルトン行だけに一本化し、大きな
  // カードと二重に出さない（D-57）。地図が使えないフォールバック表示でのみ、
  // 読み込み中もこの枠が進捗を伝える。
  const fallback = !quest && state !== 'ready' && !(state === 'loading' && mapSheetMode) ? <section className="api-load-state" aria-live="polite">
      {dataMode !== 'team-preview' && <p className="eyebrow">{dataMode === 'durable-local' ? '永続API・ローカル' : '公開APIデモ'}</p>}
      <FallbackHeading id={dataMode !== 'demo' ? undefined : 'explore-title'}>{state === 'loading' ? '問題を読み込んでいます' : state === 'empty' ? '問題はありません' : '問題を読み込めませんでした'}</FallbackHeading>
      {state === 'loading' && <p role="status">問題の一覧を取得しています。</p>}
      {state === 'empty' && <p>{selectedAreaId ? 'この地域には問題がありません。地図や地方の絞り込みから別の地域をお選びください。' : '現在選べる問題はありません。'}</p>}
      {state === 'error' && <p role="alert">{current?.missing
        ? 'この問題は見つかりません。別の問題を選べます。'
        : '通信状況を確認して、もう一度お試しください。'}</p>}
      {state !== 'loading' && <button type="button" onClick={(event) => reload(event)} disabled={refreshing}>再試行</button>}
      {!mapSheetMode && refreshControl}
      {(availableAreas.length > 0 || choices.length > 0 || state === 'empty' || state === 'error') && <>{dataMode === 'demo' && filterControls}{!mapSheetMode && picker}</>}
    </section> : undefined
  return <App openQuestRequest={openQuestRequest} authClient={authClient} quest={quest && (!activeRegion || visibleAreaIds.has(quest.areaId)) ? quest : undefined} mapAreas={regionAreas} mapQuests={visibleChoices} mapQuestsLoading={state === 'loading'} onOpenQuest={openQuestFromMap} onDeselectQuest={deselectQuest} selectedAreaId={selectedAreaId} onSelectArea={selectArea}
    areaLabel={current?.area?.label ?? '探索地域名は未掲載です'}
    questPicker={mapSheetMode ? undefined : <>{picker}{refreshControl}</>} catalogFallback={fallback} mapOverlay={filterControls} onMapSheetModeChange={setMapSheetMode} apiMode apiDataMode={dataMode} teamAnswerTrial={teamAnswerTrial} getHint={api.getHint}
    questStale={!!quest && staleQuest?.questId === quest.questId && staleQuest.version === quest.version}
    onHintVersionStale={() => { if (quest) setStaleQuest({ questId: quest.questId, version: quest.version }) }}
    onReloadQuest={(event) => reload(event)} />
}
