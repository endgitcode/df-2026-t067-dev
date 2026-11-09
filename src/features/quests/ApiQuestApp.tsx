import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import App from '../../App'
import { Icon } from '../../components/Icon'
import type { AuthClient } from '../auth/authTypes'
import { ApiError, createApiClient } from '../../shared/api/client'
import type { LocalApiDataMode } from '../../shared/api/client'
import type { Page, PublicArea, PublicQuest } from '../../shared/api/types'
import { getRegionAreas, REGIONS } from './areaHierarchy'
import {
  isPrefectureEffectivelySelected,
  regionRowSummary,
  regionWholeLabel,
  withPrefectureToggle,
  withRegionWhole,
} from './placeFilterSelection'

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

function parseListParam(params: URLSearchParams, key: string, legacyKey?: string): string[] {
  const raw = params.get(key) ?? (legacyKey ? params.get(legacyKey) : null) ?? ''
  return raw.split(',').map((item) => item.trim()).filter(Boolean)
}

function readSelectionFromUrl() {
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
  return {
    areaId: params.get('area') ?? '',
    questId: params.get('quest') ?? '',
    // 複数は regions / prefs。古い単数 region / pref も読む。
    regions: parseListParam(params, 'regions', 'region'),
    prefectures: parseListParam(params, 'prefs', 'pref'),
  }
}

function writeListParam(url: URL, key: string, values: readonly string[], legacyKey: string) {
  if (values.length > 0) url.searchParams.set(key, values.join(','))
  else url.searchParams.delete(key)
  url.searchParams.delete(legacyKey)
}

function writeSelectionToUrl(areaId: string, questId: string, mode: 'push' | 'replace', regions: readonly string[] = [], prefectures: readonly string[] = []) {
  const url = new URL(window.location.href)
  if (areaId) url.searchParams.set('area', areaId)
  else url.searchParams.delete('area')
  if (questId) url.searchParams.set('quest', questId)
  else url.searchParams.delete('quest')
  writeListParam(url, 'regions', regions, 'region')
  writeListParam(url, 'prefs', prefectures, 'pref')
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
  const [initialSelection] = useState(() => syncUrl ? readSelectionFromUrl() : { areaId: '', questId: '', regions: [] as string[], prefectures: [] as string[] })
  // URLで問題が指定されて開かれた場合（QRのディープリンク等）は、読み込み後にその問題の詳細を開く。
  const [openQuestRequest, setOpenQuestRequest] = useState<{ questId: string; sequence: number } | undefined>(
    () => initialSelection.questId ? { questId: initialSelection.questId, sequence: 1 } : undefined)
  const [selectedId, setSelectedId] = useState(initialSelection.questId)
  const [selectedAreaId, setSelectedAreaId] = useState(initialSelection.areaId)
  const [activeRegions, setActiveRegions] = useState<string[]>(() => initialSelection.regions)
  const [activePrefectures, setActivePrefectures] = useState<string[]>(() => initialSelection.prefectures)
  const [filterOpen, setFilterOpen] = useState(false)
  const filterPanelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!filterOpen) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !filterPanelRef.current?.contains(event.target)) setFilterOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      setFilterOpen(false)
      filterPanelRef.current?.querySelector<HTMLButtonElement>('.filter-toggle')?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
    }
  }, [filterOpen])
  const [openRegions, setOpenRegions] = useState<string[]>([])
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
  const filterStateRef = useRef({ regions: [] as string[], prefectures: [] as string[] })
  useEffect(() => { filterStateRef.current = { regions: activeRegions, prefectures: activePrefectures } }, [activeRegions, activePrefectures])

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
      setActiveRegions(selection.regions)
      setActivePrefectures(selection.prefectures)
      if (selection.areaId) {
        const areas = catalog.current?.areas
        const { regions, prefectures } = filterStateRef.current
        if (areas && (regions.length > 0 || prefectures.length > 0) && !getRegionAreas(areas, regions, prefectures).some((area) => area.areaId === selection.areaId)) {
          setActiveRegions([])
          setActivePrefectures([])
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
            if (syncUrl) writeSelectionToUrl(selectedAreaId, '', 'replace', filterStateRef.current.regions, filterStateRef.current.prefectures)
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
          if (syncUrl) writeSelectionToUrl(selectedAreaId, id, 'replace', filterStateRef.current.regions, filterStateRef.current.prefectures)
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
  // 選択の変更や再試行で新しい結果がまだ届いていない間は、直前の結果の一覧を
  // そのまま表示に残す（D-75）。一覧を空へ倒すと、行の連打や再取得のたびに
  // スケルトンと「読み込み中」がちらつく。新しい結果が届いたら差し替わり、
  // 失敗した場合は fail() が現在の条件にエラー結果を置くため、従来どおり
  // エラー表示へ切り替わる（前のデータは残らない）。
  const choices = current?.choices ?? (result?.api === api ? result.choices : [])
  const availableAreas = result?.api === api ? result.areas : emptyAreas
  const regionAreas = useMemo(() => getRegionAreas(availableAreas, activeRegions, activePrefectures), [availableAreas, activeRegions, activePrefectures])
  const resetAreaSelection = (regions: readonly string[] = activeRegions, prefectures: readonly string[] = activePrefectures) => {
    // 問題だけが選択されている状態（D-65）でも、絞り込み変更などでは選択を丸ごと外す。
    if (!selectedAreaId && !selectedId) return
    clearRefreshNotice()
    if (syncUrl) writeSelectionToUrl('', '', 'push', regions, prefectures)
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
    if (syncUrl) writeSelectionToUrl(selectedAreaId, '', 'push', activeRegions, activePrefectures)
    setSelectedId('')
  }

  const visibleAreaIds = useMemo(() => new Set(regionAreas.map((area) => area.areaId)), [regionAreas])
  // 一覧の並びは問題番号（都道府県コード→連番）の昇順に統一する（D-59）。API の
  // 返却順は地域の登録順で北から南にも番号順にもなっておらず、見る人に規則性が
  // 伝わらなかった。番号が無い問題は番号付きの後ろに、元の順序のまま置く。
  const visibleChoices = [...((activeRegions.length > 0 || activePrefectures.length > 0) ? choices.filter((item) => visibleAreaIds.has(item.areaId)) : choices)]
    .sort((a, b) => {
      const ka = questNumberKey(a); const kb = questNumberKey(b)
      if (ka && kb) return ka[0] - kb[0] || ka[1] - kb[1]
      return ka ? -1 : kb ? 1 : 0
    })
  // 表示上の「選択中の問題」は、実際に選択されている問題だけを指す。一覧の先頭を
  // 勝手に選択扱いすると、URL や詳細に出ている問題と別の問題が選択中として
  // 見えてしまう。先頭問題の自動選択は読み込み側が選択状態と URL を更新して行う。
  const selectedQuestId = visibleChoices.some((item) => item.questId === selectedId) ? selectedId : ''
  const syncFilterToUrl = (regions: readonly string[], prefectures: readonly string[]) => {
    if (!syncUrl) return
    writeSelectionToUrl(selectedAreaId, selectedId, 'replace', regions, prefectures)
  }
  const applyPlaceFilter = (regions: readonly string[], prefectures: readonly string[]) => {
    if (dataMode !== 'demo') setFilterOpen(false)
    setActiveRegions([...regions])
    setActivePrefectures([...prefectures])
    if (selectedAreaId || selectedId) resetAreaSelection(regions, prefectures)
    else syncFilterToUrl(regions, prefectures)
  }
  const toggleRegion = (region: string) => {
    // チップの×／再タップは地方丸ごとの ON/OFF。
    const on = !activeRegions.includes(region)
    const next = withRegionWhole(activeRegions, activePrefectures, region, on)
    applyPlaceFilter(next.regions, next.prefectures)
  }
  const toggleRegionWhole = (region: string) => {
    const on = !activeRegions.includes(region)
    const next = withRegionWhole(activeRegions, activePrefectures, region, on)
    applyPlaceFilter(next.regions, next.prefectures)
  }
  const togglePrefecture = (prefecture: string) => {
    const region = REGIONS.find((item) => (item.prefectures as readonly string[]).includes(prefecture))?.name
    if (!region) return
    const next = withPrefectureToggle(activeRegions, activePrefectures, region, prefecture)
    applyPlaceFilter(next.regions, next.prefectures)
  }
  const clearPlaceFilter = () => {
    applyPlaceFilter([], [])
  }
  const toggleRegionAccordion = (region: string) => {
    setOpenRegions((current) => current.includes(region)
      ? current.filter((item) => item !== region)
      : [region])
  }
  const openPlaceFilter = () => {
    setFilterOpen((value) => {
      const next = !value
      if (next) {
        // 開いた直後は選択中の地方を展開しておく。
        setOpenRegions(REGIONS.filter((region) =>
          activeRegions.includes(region.name)
          || region.prefectures.some((pref) => activePrefectures.includes(pref))).map((region) => region.name).slice(0, 1))
      }
      return next
    })
  }
  // 地方→県のアコーディオン（D-48 の畳みは維持）。複数選択は「または」（#160）。
  // 永続側・共有検証では選択後に欄を閉じ、選択条件は外せるチップとして残す。
  const selectedPlaceCount = activeRegions.length + activePrefectures.length
  const filterSummary = selectedPlaceCount > 0 ? `場所で絞る：${selectedPlaceCount}件` : '場所で絞る'
  const selectedArea = availableAreas.find((area) => area.areaId === selectedAreaId)
  const filterControls = <div ref={filterPanelRef} className="map-filter-panel">
    <div className={'filter-disclosure' + (filterOpen ? ' is-open' : '')}>
      <button type="button" className={'filter-toggle' + (selectedPlaceCount > 0 ? ' has-filter' : '')} aria-expanded={filterOpen} onClick={openPlaceFilter}>{filterSummary}<span className={'filter-toggle-chevron' + (filterOpen ? ' is-open' : '')} aria-hidden="true"><Icon name="chevron" /></span></button>
      <div className={'map-filter-chips-wrap' + (filterOpen ? ' is-open' : '')} aria-hidden={!filterOpen}>
        <div className="map-filter-chips-inner">
          <div className="filter-accordion" role="list" aria-label="地方から選ぶ">
            {REGIONS.map((region) => {
              const expanded = openRegions.includes(region.name)
              const summary = regionRowSummary(region.name, activeRegions, activePrefectures)
              const panelId = `place-filter-${region.name}`
              return <div key={region.name} className={'filter-accordion-item' + (summary.whole || summary.count > 0 ? ' has-selection' : '')} role="listitem">
                <button type="button" className="filter-accordion-row" aria-expanded={expanded} aria-controls={panelId}
                  aria-label={summary.label ? `${region.name}、${summary.label}` : region.name}
                  onClick={() => toggleRegionAccordion(region.name)}>
                  <span className="filter-accordion-name">{region.name}</span>
                  {summary.label ? <span className="filter-accordion-count" aria-hidden="true">{summary.label}</span> : null}
                </button>
              </div>
            })}
          </div>
          {REGIONS.filter((region) => openRegions.includes(region.name)).map((region) => {
            const summary = regionRowSummary(region.name, activeRegions, activePrefectures)
            const panelId = `place-filter-${region.name}`
            return <div key={region.name}>
                <div id={panelId} className="filter-accordion-body" role="group" aria-label={`${region.name}の都道府県`}>
                  <button type="button" className="filter-check" aria-pressed={summary.whole}
                    onClick={() => toggleRegionWhole(region.name)}>
                    <span className="filter-check-box" aria-hidden="true">{summary.whole ? '✓' : ''}</span>
                    {regionWholeLabel(region.name)}
                  </button>
                  {region.prefectures.map((prefecture) => {
                    const pressed = isPrefectureEffectivelySelected(region.name, prefecture, activeRegions, activePrefectures)
                    return <button key={prefecture} type="button" className="filter-check" aria-pressed={pressed}
                      onClick={() => togglePrefecture(prefecture)}>
                      <span className="filter-check-box" aria-hidden="true">{pressed ? '✓' : ''}</span>
                      {prefecture}
                    </button>
                  })}
                </div>
            </div>
          })}
        </div>
      </div>
    </div>
    {dataMode !== 'demo' && selectedArea && <div className="map-filter-selection">
      <button type="button" className="filter-chip" aria-label={`${selectedArea.label}のしぼり込みを外す`} onClick={() => resetAreaSelection()}>{selectedArea.label} <span aria-hidden="true">×</span></button>
      <span role="status">{visibleChoices.length}件の謎</span>
    </div>}
    {selectedPlaceCount > 0 && <div className="map-filter-selection">
      {activeRegions.map((region) => <button key={`r-${region}`} type="button" className="filter-chip" aria-label={`${region}の絞り込みを解除`} onClick={() => toggleRegion(region)}>{region} <span aria-hidden="true">×</span></button>)}
      {activePrefectures.map((prefecture) => <button key={`p-${prefecture}`} type="button" className="filter-chip" aria-label={`${prefecture}の絞り込みを解除`} onClick={() => togglePrefecture(prefecture)}>{prefecture} <span aria-hidden="true">×</span></button>)}
      <button type="button" className="filter-chip filter-clear-all" onClick={clearPlaceFilter}>すべて解除</button>
    </div>}
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
    if (syncUrl) writeSelectionToUrl(selectedAreaId, item.questId, 'push', activeRegions, activePrefectures)
    setSelectedId(item.questId)
    if (dataMode === 'durable-local') {
      setOpenQuestRequest((previous) => ({ questId: item.questId, sequence: (previous?.sequence ?? 0) + 1 }))
    }
  }
  const picker = <div className="api-quest-picker">
    {(activeRegions.length > 0 || activePrefectures.length > 0) && state !== 'loading' && state !== 'error' && !selectedQuestId && <p role="status">{visibleChoices.length ? '一覧から問題を選んでください。' : 'この条件に合う問題はありません。'}</p>}
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
    if (!availableAreas.some((item) => item.areaId === areaId)) return
    // 薄いピンも通常と同じ地域選択。対象を一覧にも出すため場所フィルタを解除する。
    if (!visibleAreaIds.has(areaId)) { setActiveRegions([]); setActivePrefectures([]) }
    clearRefreshNotice()
    if (syncUrl) writeSelectionToUrl(areaId, '', 'push', activeRegions, activePrefectures)
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
    if (syncUrl) writeSelectionToUrl(selectedAreaId, questId, 'push', activeRegions, activePrefectures)
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
  return <App openQuestRequest={openQuestRequest} authClient={authClient} quest={quest && ((activeRegions.length === 0 && activePrefectures.length === 0) || visibleAreaIds.has(quest.areaId)) ? quest : undefined} mapAreas={availableAreas} filterRegion={activeRegions} filterPrefecture={activePrefectures} mapQuests={visibleChoices} mapQuestsLoading={state === 'loading' && visibleChoices.length === 0} onOpenQuest={openQuestFromMap} onDeselectQuest={deselectQuest} selectedAreaId={selectedAreaId} onSelectArea={selectArea}
    areaLabel={current?.area?.label ?? '探索地域名は未掲載です'}
    questPicker={mapSheetMode ? undefined : <>{picker}{refreshControl}</>} catalogFallback={fallback} mapOverlay={filterControls} onMapSheetModeChange={setMapSheetMode} apiMode apiDataMode={dataMode} teamAnswerTrial={teamAnswerTrial} getHint={api.getHint}
    questStale={!!quest && staleQuest?.questId === quest.questId && staleQuest.version === quest.version}
    onHintVersionStale={() => { if (quest) setStaleQuest({ questId: quest.questId, version: quest.version }) }}
    onReloadQuest={(event) => reload(event)} />
}
