import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import { Icon } from '../../components/Icon'
import type { PublicArea, PublicQuest } from '../../shared/api/types'
import { useWideViewport } from '../quests/useWideViewport'
import { ExploreBottomSheet, SHEET_PEEK_HEIGHT } from './ExploreBottomSheet'
import { mobileHeaderClearance, scrollBelowHeader } from './scrollBelowHeader'
import { visibleAreaFitPadding } from './fitPadding'
import { ExploreQuestList } from './ExploreQuestList'
import { loadGoogleMaps, subscribeMapsAuthFailure, type DataLayer, type MapInstance, type MarkerInstance } from './googleMapsLoader'
import { arrangePins } from './pinClustering'
import { MAP_PIN_ACTIVE_COLOR as PIN_ACTIVE_COLOR, MAP_PIN_COLOR as PIN_COLOR, MAP_PIN_SELECTED_COLOR as PIN_SELECTED_COLOR, MAP_PIN_STROKE as PIN_STROKE, MAP_STYLES } from './mapStyles'
import { areaPinPosition } from './viewportQuests'

const JAPAN = { lat: 36.2048, lng: 138.2529 }
// 日本国内専用の見た目（D-27／D-41）は、初期表示の日本全体フィットと最小ズームで維持する。
// 地図の restriction は使わない：表示範囲が restriction の幅より広いズームでは、ライブラリが
// setCenter を restriction のメルカトル中心（北緯35.605…・東経134.5）へ固定してしまい、
// fitBounds がセットした中心が差し替わって「ピンと違う場所へ飛ぶ」不具合になったため撤去した
// （2026-11-08 の実測で確定。詳細は decisions.md の D-41 追記）。
// 国外を薄く落とすベールも、相方だった restriction の撤去で飾りだけが残り、見た目も
// しっくり来なかったため撤去した（D-41 追記）。移動範囲は制限しない。
// これ以上引くと日本が小さくなりすぎるため、最小ズームも引き上げる（D-41）。
// 当初は初期表示の日本全体フィットの下限に合わせて 4.5（小数）だったが、Mac のトラックパッドで
// 最小ズームからさらに縮小ピンチをすると画面がちらつく報告があり、整数の 5 に変更した（D-67）。
// 実測でも実効の下限は 5 で、初期フィットは Maps 側で 5 にクランプされても破綻しない。
const MIN_ZOOM = 5
const INITIAL_ZOOM = 5
const MAX_ZOOM = 20
// フィットで寄せる倍率の上限（D-60 追記）。対象が実質1点だと fitBounds が最大倍率まで
// 寄ってしまい、ピン1つと空白の地図になる。地域の境界や周辺の道路が見える程度に留める。
// 利用者が自分で寄せる操作（最大20）と現在地への寄せ（14）は対象外。
const FIT_MAX_ZOOM = 12
const LOCATION_ZOOM = 14
const LOCATION_DEADLINE_MS = 10_000
const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''

function pinIcon(color: string, count: number, emphasized = false): { url: string } {
  const center = count >= 2
    ? `<circle cx="18" cy="17" r="9.5" fill="#ffffff"/><text x="18" y="21.5" text-anchor="middle" font-family="sans-serif" font-size="${count >= 10 ? 10 : 12}" font-weight="700" fill="${PIN_STROKE}">${count}</text>`
    : '<circle cx="18" cy="17" r="7" fill="#ffffff"/>'
  // ピンの色は青と赤だけ。ホバー／フォーカス中は赤くし、選択中も呼び出し側が同じ赤を渡す。
  const fill = emphasized ? PIN_ACTIVE_COLOR : color
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${emphasized ? 42 : 36}" height="${emphasized ? 51 : 44}" viewBox="0 0 36 44"><path d="M18 1C9.2 1 2 8.2 2 17c0 10.5 16 26 16 26s16-15.5 16-26C34 8.2 26.8 1 18 1Z" fill="${fill}" stroke="${PIN_STROKE}" stroke-width="${emphasized ? 3 : 2}"/>${center}</svg>`
  return { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}` }
}

// クラスタマーカー（D-52）：重なったピンの合計問題数を出す丸いバッジ。ピンの色（青）に揃え、
// 形でピンと区別する（尾のない円＋二重リング）。
function clusterIcon(totalQuests: number): { url: string } {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="${PIN_COLOR}" stroke="${PIN_STROKE}" stroke-width="2"/><circle cx="20" cy="20" r="12" fill="#ffffff"/><text x="20" y="25" text-anchor="middle" font-family="sans-serif" font-size="${totalQuests >= 10 ? 11 : 13}" font-weight="700" fill="${PIN_STROKE}">${totalQuests}</text></svg>`
  return { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}` }
}

const LOCATION_SUCCESS_MESSAGE = '現在地を地図の中心に表示しました。'

function focusQuestDestination(card: HTMLDivElement | null | undefined, list: HTMLElement | null) {
  const destination = card?.querySelector<HTMLElement>('.quest-card-heading h3') ?? list
  if (!destination) return
  destination.tabIndex = -1
  destination.focus({ preventScroll: true })
  scrollBelowHeader(destination)
}

// 地域の公開ジオメトリから、フィットに使える全頂点を {lat, lng} で返す。閉じていない・
// 範囲外の座標を含むリングは丸ごと除く（従来のフィットと同じ検証）。使える輪郭が無ければ null。
function areaFitPoints(area: PublicArea): Array<{ lat: number; lng: number }> | null {
  const geometry = area.publicGeometry
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  const validPolygons = polygons.filter((polygon) => polygon.length > 0 && polygon.every((ring) => {
    if (ring.length < 4) return false
    const validPoints = ring.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90)
    const [firstLng, firstLat] = ring[0]
    const [lastLng, lastLat] = ring[ring.length - 1]
    return validPoints && firstLng === lastLng && firstLat === lastLat
  }))
  if (!validPolygons.length) return null
  const points: Array<{ lat: number; lng: number }> = []
  validPolygons.forEach((polygon) => polygon.forEach((ring) => ring.forEach(([lng, lat]) => points.push({ lat, lng }))))
  return points
}

// フィットの結果が上限より寄っていたら上限まで引く。実際に引いたら true を返す
// （引いた場合は次の idle でカメラが確定する）。
function clampFitZoom(instance: MapInstance): boolean {
  try {
    const zoom = instance.getZoom()
    if (zoom !== undefined && zoom > FIT_MAX_ZOOM) { instance.setZoom(FIT_MAX_ZOOM); return true }
  } catch { /* カメラが読めなければ上限なしで続ける。 */ }
  return false
}

// 記録を伴わないフィット向け：完了（idle）後に一度だけ上限を適用する。
function clampFitZoomOnIdle(instance: MapInstance): void {
  try {
    const listener = instance.addListener('idle', () => {
      try { listener.remove() } catch { /* SDK teardown is best effort. */ }
      clampFitZoom(instance)
    })
  } catch { /* リスナーを付けられない環境では上限なしで続ける。 */ }
}

export function MapPreview({ areas = [], selectedAreaId = '', onSelectArea, showPublicAreas = true, quests = [], questsLoading = false, onOpenQuest, onDeselectQuest, selectedQuestId = '', clearedQuestIds, topOverlay, showBoundaryCredit = false, fillSelectedAreaOnly = false, panelExtra, onSheetModeChange, questScrollTarget, questDetail, viewActive = true }: {
  areas?: PublicArea[]; selectedAreaId?: string; onSelectArea?: (areaId: string) => void; showPublicAreas?: boolean
  quests?: PublicQuest[]; questsLoading?: boolean; onOpenQuest?: (questId: string) => void; onDeselectQuest?: () => void; selectedQuestId?: string; clearedQuestIds?: ReadonlySet<string>
  /** 探索画面が前面にあるか。記録画面の表示中は探索側を隠したまま常駐させるため、
      その間は全画面化のシェル（body クラス）を外し、シート表示の通知も止める。
      地図インスタンスやフィット記録は保持し、戻った時にそのまま続きから使える。 */
  viewActive?: boolean
  /** 選択中の問題の詳細。一覧の選択中の行の直下にアコーディオンとして差し込む（D-46）。
      別枠で下に置くとタイトルが二重に出て煩雑になるため、置き場所は一覧の中に寄せる。 */
  questDetail?: ReactNode
  /** シート表示（地図が使えてカード一覧が出ている状態）かどうかを呼び出し側へ知らせる。
      問題の選択手段の出し分け（地図が使える間はカード一覧に一本化し、全件ピッカーは
      地図が使えないフォールバック専用にする、D-43）に使う。 */
  onSheetModeChange?: (sheetMode: boolean) => void
  /** PC幅で地図の下に出ていた内容（問題の選択・詳細・注意書き）をサイドバーのパネル内へ寄せるための追加コンテンツ。
      パネル表示ではサイドバー内、地図が使えない時は通常フローのリスト末尾に出す。シート表示（スマホ幅）では出さない。 */
  panelExtra?: ReactNode
  questScrollTarget?: RefObject<HTMLDivElement | null>
  /** 境界データの出典（国土数値情報 N03）をシート内に小さく出す。共有検証サイトの探索地図でのみ有効にする。 */
  showBoundaryCredit?: boolean
  /** 地域の塗りを「選択中の地域だけ」にする（D-29）。共有検証サイトの探索地図でのみ有効にする。 */
  fillSelectedAreaOnly?: boolean
  /** 地図の上部に浮かせて出す操作（地方・都道府県フィルタ等）。地図が使えない時は地図下の通常フローに出す。 */
  topOverlay?: ReactNode
}) {
  const target = useRef<HTMLDivElement>(null)
  const map = useRef<MapInstance | null>(null)
  const dataLayer = useRef<DataLayer | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error' | 'auth-error'>(API_KEY ? 'loading' : 'missing')
  // PC幅（981px以上）ではボトムシートを使わず、左サイドバーのパネルに一覧を出す（D-34）。
  const wideViewport = useWideViewport()
  const [zoom, setZoom] = useState(INITIAL_ZOOM)
  const [locationStatus, setLocationStatus] = useState('')
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null)

  // 結果メッセージは常駐させない。成功は5秒、案内を含む失敗は読む時間を取って
  // 10秒で消す（D-58）。閉じるボタンでも即座に消せる。取得中は確定まで消さない。
  useEffect(() => {
    if (!locationStatus || locationStatus === '現在地を取得しています…') return
    const timeout = window.setTimeout(() => setLocationStatus(''),
      locationStatus.startsWith(LOCATION_SUCCESS_MESSAGE) ? 5000 : 10_000)
    return () => window.clearTimeout(timeout)
  }, [locationStatus])
  // 位置情報の送信案内は常駐させず、そのセッションで初めて現在地を使う時に結果メッセージへ一度だけ添える（D-28）。
  const locationNoticeShown = useRef(false)
  const withLocationNotice = (message: string) => {
    if (locationNoticeShown.current) return message
    locationNoticeShown.current = true
    return `${message} 位置情報はGoogle Mapsに送信されます。`
  }
  const [locating, setLocating] = useState(false)
  const locationRequest = useRef(0)
  const locationTimer = useRef<number | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)
  const [fitRequest, setFitRequest] = useState(0)
  // カメラを寄せる対象の地域。地域が選択されていればその地域、そうでなければ選択中の
  // 問題の所属地域（D-65）。問題を選んでも地域の選択状態は変わらないが、地図の寄せ
  // （D-44）と選択直前カメラの復元は従来どおり問題の所属地域に対しても発生させる。
  // 地域の塗り（D-29）・ピンの選択表示・ピンの再タップ判定は地域選択だけに連動する。
  const selectedQuestAreaId = selectedQuestId ? quests.find((quest) => quest.questId === selectedQuestId)?.areaId ?? '' : ''
  const fitAreaId = selectedAreaId || selectedQuestAreaId
  // フィット対象の同一性。「問題経由で寄せた地域」と「地域として選んだ地域」は同じ
  // 地域でも対象としては区別する：問題選択の後に同じ地域のピンを押したら、選択の
  // 成立に合わせて寄せ直しが起きるようにするため（D-44 の「押したのに移行しない」
  // への対応の考え方を、問題→地域の移行にも保つ）。
  const fitKey = fitAreaId ? `${selectedAreaId ? 'area' : 'quest'}:${fitAreaId}` : ''

  useEffect(() => {
    const instance = map.current
    const Marker = window.google?.maps?.Marker
    if (!instance || !Marker || status !== 'ready' || !currentLocation) return
    try {
      const marker = new Marker({
        map: instance,
        position: currentLocation,
        title: '現在地',
        clickable: false,
        zIndex: 3,
        icon: {
          path: 'M9 -9 3 9 -1 1 -9 -3 9 -9Z',
          fillColor: '#111827',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeOpacity: 1,
          strokeWeight: 2,
          scale: 1.4,
        },
      })
      return () => { try { marker.setMap(null) } catch { /* SDK teardown is best effort. */ } }
    } catch { /* 現在地マークが表示できなくても地図は利用できる。 */ }
  }, [currentLocation, status, attempt])
  const [areaAttempt, setAreaAttempt] = useState(0)
  const [areaFailed, setAreaFailed] = useState(false)
  const [pinAreaId, setPinAreaId] = useState<string | null>(null)
  const [sheetHeight, setSheetHeight] = useState(SHEET_PEEK_HEIGHT)
  // PC幅サイドバーの開閉（D-36）。その場の操作感を優先し、状態はメモリのみで保持する。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  // フィット時のパディングは「フィットする時点」の開閉状態で決める。開閉のたびに
  // 再フィットすると地図の中心が動いてしまうため（D-38）、フィット側の effect の
  // 依存には開閉状態を入れず、ref 経由で現在の値だけを読む。
  const sidebarCollapsedRef = useRef(false)
  // フィット済みの対象の記録。対象は「地域の選択」だけではなく「問題の選択」も含む
  // ため、地域IDではなく対象キー（下記の fitKey）で持つ。
  const lastViewportSelection = useRef<{ map: MapInstance; key: string } | null>(null)
  // 地域を選ぶ直前のカメラ（中心・ズーム）。選択を解除したら、初期表示ではなくこの状態へ戻す。
  const preSelectionCamera = useRef<{ map: MapInstance; center: { lat: number; lng: number }; zoom: number } | null>(null)
  const initialFitDone = useRef<MapInstance | null>(null)
  // 初期フィットを実行した時点のレイアウトシグネチャ。レイアウト確定側の effect が、
  // 確定後のシグネチャと食い違う時だけ初期フィットを合わせ直すために使う（D-72）。
  const initialFitSignature = useRef<string | null>(null)
  // レイアウト（シート方式／パネル方式）の確定シグネチャ。確定側の effect が記録する。
  const settledLayout = useRef('')
  const lastAreaSelection = useRef<{ map: MapInstance; areaId: string } | null>(null)
  const areaFailureTimer = useRef<number | undefined>(undefined)
  const cancelLocationRequest = (updateState = true) => {
    locationRequest.current += 1
    window.clearTimeout(locationTimer.current)
    locationTimer.current = undefined
    if (updateState) { setLocating(false); setLocationStatus('') }
  }
  const failArea = () => {
    window.clearTimeout(areaFailureTimer.current)
    areaFailureTimer.current = window.setTimeout(() => { areaFailureTimer.current = undefined; setAreaFailed(true) }, 0)
  }
  // 選択中地域へのフィットが完了した時点のカメラ（中心・ズーム）。フィット完了（idle）ごとに
  // 記録し直す。選択中の地域をもう一度押した時、カメラがこの位置から動いていれば「解除」
  // ではなく「もう一度寄せる」を優先するための判定材料（利用者は移行を期待して押している）。
  const fittedCamera = useRef<{ map: MapInstance; areaId: string; center: { lat: number; lng: number }; zoom: number } | null>(null)
  // フィット完了の記録待ちリスナー（idle／dragstart）。次のフィット開始時に打ち切る。
  const pendingFitListeners = useRef<Array<{ remove(): void }>>([])
  // 地図が使える時は全画面マップ＋ボトムシート（sheetMode）、PC幅ではシートの代わりに
  // 左サイドバーのパネルへ同じ一覧を出す（panelMode、D-34）。全画面化の扱いはシートと同じ。
  // フィット系のコールバック（fitInitialAreas）がレイアウトシグネチャの算出に使うため、
  // この位置で定義する。
  const sheetMode = status === 'ready' && showPublicAreas
  const panelMode = sheetMode && wideViewport
  // 地域の範囲へ地図をフィットさせる共通処理。選択時フィットと、再タップ時の再フィットで使う。
  // 地図の上に重なる帯・チップ・シート等の分をパディングとして差し引き、選んだ地域が
  // 実際に見えている領域の中央に来るようにする。
  const fitToArea = useCallback((instance: MapInstance, area: PublicArea): boolean => {
    const google = window.google?.maps
    if (!google?.LatLngBounds) return false
    const points = areaFitPoints(area)
    if (!points) return false
    const bounds = new google.LatLngBounds()
    points.forEach((point) => bounds.extend(point))
    fittedCamera.current = null
    for (const pending of pendingFitListeners.current) { try { pending.remove() } catch { /* SDK teardown is best effort. */ } }
    pendingFitListeners.current = []
    if (showPublicAreas) {
      // スマホ幅の選択フィットでは、選択でシートが half まで開く前提で下パディングを
      // 見積もる（D-70）。peek 前提のままだと、開いたシートの裏にピンが隠れる。
      // ステージの高さは地図キャンバスの実高から取り、half の定義（ExploreBottomSheet の
      // snapHeights）と揃える。読めない時は peek 前提に倒す。
      const stageHeight = target.current?.clientHeight ?? 0
      const sheetFitHeight = Math.max(SHEET_PEEK_HEIGHT, Math.round(stageHeight * 0.55))
      instance.fitBounds(bounds, visibleAreaFitPadding(wideViewport, sidebarCollapsedRef.current, wideViewport ? undefined : sheetFitHeight))
    } else instance.fitBounds(bounds)
    try {
      // フィット完了（idle）前に利用者が地図を掴んだら、その回の完了位置は記録しない
      // （PR #65 への taitai のレビュー指摘 [P2]）。ドラッグで止まった位置をフィット完了位置と
      // して記録すると、再タップ時に「フィット位置にいる」と誤認し、寄せ直さず選択を解除してしまう。
      // リスナーの削除だけに頼らず、割り込みフラグでも記録を止める（idle が後から届いても無効）。
      let interrupted = false
      let settled = false
      const myListeners: Array<{ remove(): void }> = []
      const settle = () => {
        if (settled) return
        settled = true
        for (const pending of myListeners) { try { pending.remove() } catch { /* SDK teardown is best effort. */ } }
        if (pendingFitListeners.current === myListeners) pendingFitListeners.current = []
      }
      const idleListener = instance.addListener('idle', () => {
        if (interrupted) { settle(); return }
        // 寄り過ぎていたら上限まで引き、次の idle で確定した位置を記録する（D-60 追記）。
        if (clampFitZoom(instance)) return
        settle()
        try {
          const center = instance.getCenter?.()
          if (center) fittedCamera.current = { map: instance, areaId: area.areaId, center: { lat: center.lat(), lng: center.lng() }, zoom: instance.getZoom() ?? INITIAL_ZOOM }
        } catch { /* カメラが読めなければ記録なし（再タップ時は再フィット優先のまま）。 */ }
      })
      const dragListener = instance.addListener('dragstart', () => { interrupted = true; settle() })
      myListeners.push(idleListener, dragListener)
      pendingFitListeners.current = myListeners
    } catch { /* リスナーを付けられない環境では記録を諦める。 */ }
    return true
  }, [showPublicAreas, wideViewport])
  // 初期表示のフィット（ピンが立つ地域全体を「実際に見えている領域」へ収める）。
  // マーカー生成時の初回と、レイアウト確定後に実サイズへ合わせ直す時（D-72）の
  // 両方から使う。フィットした時点のレイアウトシグネチャを記録しておき、確定側は
  // 「確定前のシグネチャでフィット済み」の時だけ合わせ直す（同じ確定では二度直さない）。
  const fitInitialAreas = useCallback((instance: MapInstance): boolean => {
    const google = window.google?.maps
    if (!google?.LatLngBounds) return false
    const bounds = new google.LatLngBounds()
    let fitted = false
    for (const area of areas) {
      if (area.publishedCount < 1) continue
      const position = areaPinPosition(area)
      if (!position) continue
      bounds.extend(position)
      fitted = true
    }
    if (!fitted) return false
    instance.fitBounds(bounds, visibleAreaFitPadding(wideViewport, sidebarCollapsedRef.current))
    clampFitZoomOnIdle(instance)
    initialFitDone.current = instance
    initialFitSignature.current = `${sheetMode}:${panelMode}`
    return true
  }, [areas, wideViewport, sheetMode, panelMode])
  // カメラが、その地域へのフィット完了位置に（実質）留まっているか。
  const cameraAtFit = useCallback((instance: MapInstance, areaId: string): boolean => {
    const snapshot = fittedCamera.current
    if (!snapshot || snapshot.map !== instance || snapshot.areaId !== areaId) return false
    try {
      const center = instance.getCenter?.()
      if (!center) return false
      return Math.abs(center.lat() - snapshot.center.lat) < 1e-6 && Math.abs(center.lng() - snapshot.center.lng) < 1e-6
        && Math.abs((instance.getZoom() ?? INITIAL_ZOOM) - snapshot.zoom) < 1e-6
    } catch { return false }
  }, [])
  // 選択中の地域がもう一度押された（ピン／地域レイヤー）時の共通の扱い。カメラがフィット
  // 位置から動いていれば、選択は解除せずその地域へ寄せ直して true を返す。フィット位置に
  // いる時（と、選択中でない時）は false を返し、呼び出し側の従来動作（選択／解除）に委ねる。
  const refitIfCameraMoved = useCallback((instance: MapInstance, area: PublicArea): boolean => {
    if (area.areaId !== selectedAreaId) return false
    if (cameraAtFit(instance, area.areaId)) return false
    return fitToArea(instance, area)
  }, [selectedAreaId, cameraAtFit, fitToArea])

  useEffect(() => {
    if (!API_KEY || !target.current) return
    let active = true
    let authFailed = false
    let zoomListener: { remove(): void } | undefined
    const unsubscribeAuth = subscribeMapsAuthFailure(() => {
      authFailed = true
      if (active) { cancelLocationRequest(); map.current = null; setStatus('auth-error') }
    })
    void loadGoogleMaps(API_KEY).then((google) => {
      if (!active || authFailed || !target.current) return
      let instance: MapInstance
      try {
        instance = new google.Map(target.current, {
          center: JAPAN, zoom: INITIAL_ZOOM, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM,
          disableDefaultUI: true, mapTypeControl: false, streetViewControl: false,
          fullscreenControl: false, clickableIcons: false, gestureHandling: 'greedy',
          styles: MAP_STYLES,
        }) as MapInstance
        if (authFailed) return
        map.current = instance
        try {
          const layer = new google.Data()
          layer.setMap(instance)
          dataLayer.current = layer
        } catch { failArea() }
        zoomListener = instance.addListener('zoom_changed', () => {
          if (active) setZoom(instance.getZoom() ?? 5)
        })
        setStatus('ready')
      } catch {
        if (active) setStatus('error')
        return
      }
    }).catch((error: unknown) => { if (active) setStatus(error instanceof Error && error.message === 'auth' ? 'auth-error' : 'error') })
    return () => {
      active = false
      cancelLocationRequest(false)
      window.clearTimeout(areaFailureTimer.current)
      unsubscribeAuth()
      try { zoomListener?.remove() } catch { /* SDK teardown is best effort. */ }
      try { dataLayer.current?.setMap(null) } catch { /* SDK teardown is best effort. */ }
      dataLayer.current = null
      map.current = null
    }
  }, [attempt])

  useEffect(() => {
    let layer = dataLayer.current
    if (!layer && status === 'ready' && showPublicAreas && API_KEY && map.current && window.google?.maps) {
      try { layer = new window.google.maps.Data(); layer.setMap(map.current); dataLayer.current = layer }
      catch { failArea(); return }
    }
    if (!layer) return
    let active = true
    let listener: { remove(): void } | undefined
    try {
      window.clearTimeout(areaFailureTimer.current)
      areaFailureTimer.current = undefined
      layer.setMap(null)
      layer.forEach((feature) => layer.remove(feature))
      if (!showPublicAreas || status !== 'ready') return () => { active = false }
      const features = areas.flatMap((area) => {
        const geometry = area.publicGeometry
        const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
        const valid = polygons.filter((polygon) => polygon.length > 0 && polygon.every((ring) => {
          if (ring.length < 4) return false
          const validPoints = ring.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90)
          const [firstLng, firstLat] = ring[0]
          const [lastLng, lastLat] = ring[ring.length - 1]
          return validPoints && firstLng === lastLng && firstLat === lastLat
        }))
        if (!valid.length) return []
        return [{ type: 'Feature' as const, id: area.areaId, properties: { areaId: area.areaId },
          geometry: { type: geometry.type, coordinates: geometry.type === 'Polygon' ? valid[0] : valid } }]
      })
      if (!features.length) return () => { active = false }
      layer.setMap(map.current)
      layer.addGeoJson({ type: 'FeatureCollection', features })
      layer.setStyle((feature) => {
        const selected = feature.getProperty('areaId') === selectedAreaId
        // D-29: 選択中の地域だけ塗るモードでは、未選択の地域は塗りも枠線も出さずピンだけにする。
        if (fillSelectedAreaOnly && !selected) {
          return { fillColor: PIN_COLOR, fillOpacity: 0, strokeColor: PIN_STROKE, strokeOpacity: 0, strokeWeight: 0, clickable: false }
        }
        return {
          fillColor: selected ? PIN_SELECTED_COLOR : PIN_COLOR,
          fillOpacity: selected ? 0.55 : 0.25,
          strokeColor: PIN_STROKE, strokeOpacity: 0.9, strokeWeight: selected ? 3 : 1.5,
          clickable: true,
        }
      })
      listener = layer.addListener('click', (event) => {
        const areaId = event.feature.getProperty('areaId')
        if (!active || typeof areaId !== 'string') return
        const area = areas.find((candidate) => candidate.areaId === areaId)
        if (!area) return
        // 選択中の地域を、地図を動かした後にもう一度押したら、解除せずその地域へ寄せ直す。
        const instance = map.current
        if (instance && refitIfCameraMoved(instance, area)) return
        setPinAreaId(null); onSelectArea?.(areaId)
      })
    } catch {
      active = false
      try { listener?.remove(); layer.setMap(null); layer.forEach((feature) => layer.remove(feature)) } catch { /* Keep the base map usable. */ }
      failArea()
    }
    return () => { active = false; window.clearTimeout(areaFailureTimer.current); areaFailureTimer.current = undefined; try { listener?.remove(); layer.setMap(null) } catch { /* SDK teardown is best effort. */ } }
  }, [areas, selectedAreaId, onSelectArea, showPublicAreas, status, areaAttempt, fillSelectedAreaOnly, refitIfCameraMoved])

  useEffect(() => {
    const instance = map.current
    const google = window.google?.maps
    if (!API_KEY || !instance || !google?.Marker || !showPublicAreas || status !== 'ready') return
    let active = true
    const created: MarkerInstance[] = []
    const listeners: Array<{ remove(): void }> = []
    try {
      // 現在のズームで画面上重なるピンはクラスタにまとめる（D-52）。フィット対象の
      // 地域（選択中の地域／選択中の問題の所属地域）のピンはクラスタに隠さず常に
      // 対象外とする。まとめ直しはズームが変わるたびにこの効果が担う。
      const pinPoints = []
      const areaById = new Map<string, PublicArea>()
      for (const area of areas) {
        if (area.publishedCount < 1) continue
        const position = areaPinPosition(area)
        if (!position) continue
        pinPoints.push({ areaId: area.areaId, lat: position.lat, lng: position.lng, questCount: area.publishedCount })
        areaById.set(area.areaId, area)
      }
      for (const arrangement of arrangePins(pinPoints, zoom, fitAreaId)) {
        if (arrangement.kind === 'cluster') {
          const marker = new google.Marker({
            position: { lat: arrangement.lat, lng: arrangement.lng }, map: instance,
            title: `重なっている${arrangement.points.length}地域のピン（合計${arrangement.totalQuests}問）`,
            icon: clusterIcon(arrangement.totalQuests),
            cursor: 'pointer',
            zIndex: 0,
          })
          listeners.push(marker.addListener('click', () => {
            if (!active || !google.LatLngBounds) return
            // クラスタを押したら、中の地域がバラけて見える位置・ズームへ寄せる（対象地域群へのフィット）。
            const bounds = new google.LatLngBounds()
            let fitted = false
            for (const point of arrangement.points) {
              const member = areaById.get(point.areaId)
              const fitPoints = member ? areaFitPoints(member) : null
              if (fitPoints) for (const fitPoint of fitPoints) { bounds.extend(fitPoint); fitted = true }
              else { bounds.extend({ lat: point.lat, lng: point.lng }); fitted = true }
            }
            if (fitted) { instance.fitBounds(bounds, visibleAreaFitPadding(wideViewport, sidebarCollapsedRef.current)); clampFitZoomOnIdle(instance) }
          }))
          created.push(marker)
          continue
        }
        const area = areaById.get(arrangement.point.areaId)
        if (!area) continue
        const position = { lat: arrangement.point.lat, lng: arrangement.point.lng }
        const selected = area.areaId === selectedAreaId
        // 選択中のピンもホバーと同じ赤にする（ピン本体に黄色は使わない。黄色は地域の塗りだけ）。
        const pinColor = selected ? PIN_ACTIVE_COLOR : PIN_COLOR
        const marker = new google.Marker({
          position, map: instance,
          title: `${area.label}の探索エリア（${area.publishedCount}問）`,
          icon: pinIcon(pinColor, area.publishedCount),
          cursor: 'pointer',
          zIndex: selected ? 2 : 1,
        })
        listeners.push(marker.addListener('click', () => {
          if (!active) return
          // 選択中のピンをもう一度押した時、カメラがフィット位置から動いていれば解除せず
          // その地域へ寄せ直す（押したのに移行しない、への対応）。フィット位置にいる時だけ
          // 従来どおり選択解除として扱う（ハイライトを外し、解除は呼び出し側が担う）。
          if (selected && refitIfCameraMoved(instance, area)) return
          setPinAreaId((current) => (current === area.areaId ? null : area.areaId))
          onSelectArea?.(area.areaId)
        }))
        // Google Maps のポインタイベントに任せ、PC・タッチ端末で共通の強調表示を行う。
        if (marker.setIcon) {
          listeners.push(marker.addListener('mouseover', () => {
            if (active) marker.setIcon?.(pinIcon(pinColor, area.publishedCount, true))
          }))
          listeners.push(marker.addListener('mouseout', () => {
            if (active) marker.setIcon?.(pinIcon(pinColor, area.publishedCount))
          }))
        }
        created.push(marker)
      }
      // 初期表示は、ピンが立つ地域全体が「実際に見えている領域」に収まるよう一度だけフィットする。
      if (initialFitDone.current !== instance && !fitAreaId) fitInitialAreas(instance)
    } catch { /* ピンは補助表示のため、失敗しても地図本体は使える状態を保つ。 */ }
    return () => {
      active = false
      for (const listener of listeners) { try { listener.remove() } catch { /* SDK teardown is best effort. */ } }
      for (const marker of created) { try { marker.setMap(null) } catch { /* SDK teardown is best effort. */ } }
    }
  }, [areas, selectedAreaId, fitAreaId, onSelectArea, showPublicAreas, status, areaAttempt, attempt, wideViewport, refitIfCameraMoved, zoom, fitInitialAreas])

  useEffect(() => {
    const instance = map.current
    const google = window.google?.maps
    if (!API_KEY || !instance || !google || !showPublicAreas || status !== 'ready') return
    if (lastAreaSelection.current?.map === instance && lastAreaSelection.current.areaId !== selectedAreaId) cancelLocationRequest()
    lastAreaSelection.current = { map: instance, areaId: selectedAreaId }
    if (lastViewportSelection.current?.map === instance && lastViewportSelection.current.key === fitKey) return
    if (!fitAreaId) {
      // 選択解除では初期表示へ戻さず、選択直前のカメラを復元する。選択後に手動で動かしていても、
      // 解除時は選択前の状態へ戻す（「選ぶ前の地図に戻る」を単純な仕様として採る）。
      const saved = preSelectionCamera.current
      if (saved && saved.map === instance) {
        instance.setCenter(saved.center)
        instance.setZoom(saved.zoom)
        preSelectionCamera.current = null
      } else if (lastViewportSelection.current?.map === instance && lastViewportSelection.current.key !== '') {
        // この地図で選択が実際に処理された後の解除で、直前カメラが読めなかった時だけ
        // 初期表示（日本中心）へ戻す。
        instance.setCenter(JAPAN); instance.setZoom(INITIAL_ZOOM)
      }
      // 初期マウント時（この地図でまだ選択が処理されていない時）はカメラに触らない。
      // 初期カメラはマーカー側の初期フィットが決めるもので、ここで日本中心＋初期ズームを
      // 書くと、同じコミットで走る初期フィットと競合して初期表示が崩れた（D-72）。
      fittedCamera.current = null
      lastViewportSelection.current = { map: instance, key: '' }
      return
    }
    // フィット対象が無い状態から移る時だけ、フィット直前のカメラを覚える。対象の
    // 切替（地域A→B、問題→別の問題、問題→その所属地域の選択）では上書きせず、
    // 解除時に「最初に選ぶ前」の状態へ戻れるようにする。
    const previousSelection = lastViewportSelection.current
    if (!previousSelection || previousSelection.map !== instance || previousSelection.key === '') {
      try {
        const center = instance.getCenter?.()
        if (center) preSelectionCamera.current = { map: instance, center: { lat: center.lat(), lng: center.lng() }, zoom: instance.getZoom() ?? INITIAL_ZOOM }
      } catch { /* カメラが読めない時は復元を諦め、解除時は従来どおり初期表示へ戻す。 */ }
    }
    try {
      const area = areas.find((candidate) => candidate.areaId === fitAreaId)
      if (!area) return
      if (!fitToArea(instance, area)) return
      initialFitDone.current = instance
      lastViewportSelection.current = { map: instance, key: fitKey }
    } catch { failArea() }
  }, [selectedAreaId, fitAreaId, fitKey, areas, showPublicAreas, status, areaAttempt, wideViewport, fitRequest, fitToArea])

  // 地方・都道府県の絞り込みで地域の集合が変わったら、その範囲へ地図を寄せる（D-60）。
  // 絞っても地図が日本全体のままだと、絞った結果が空っぽに見えた。
  // 解除して全件に戻れば、初期表示と同じ全ピンの範囲へ戻る。読み込み中の一時的な
  // 空は範囲変更として扱わない。地域・問題のいずれかが選択中は選択フィットが優先する。
  // 範囲は地域の境界形状から作り、寄せ過ぎは上限で抑える（D-60 追記）。
  const lastAreasKey = useRef<{ map: MapInstance; key: string } | null>(null)
  useEffect(() => {
    const instance = map.current
    if (!API_KEY || !instance || status !== 'ready' || areas.length === 0) return
    const key = areas.map((area) => area.areaId).sort().join(',')
    const previous = lastAreasKey.current
    lastAreasKey.current = { map: instance, key }
    if (!previous || previous.map !== instance || previous.key === key) return
    if (fitAreaId) return
    const google = window.google?.maps
    if (!google?.LatLngBounds) return
    const bounds = new google.LatLngBounds()
    let fitted = false
    for (const area of areas) {
      if (area.publishedCount < 1) continue
      // 範囲はピンの位置ではなく地域の境界形状で作る（D-60 追記）。ピン位置だけだと
      // 対象が1地域の時に範囲が実質1点になり、最大倍率まで寄ってしまった。
      const fitPoints = areaFitPoints(area)
      if (fitPoints) {
        for (const point of fitPoints) { bounds.extend(point); fitted = true }
        continue
      }
      const position = areaPinPosition(area)
      if (!position) continue
      bounds.extend(position)
      fitted = true
    }
    if (!fitted) return
    if (showPublicAreas) instance.fitBounds(bounds, visibleAreaFitPadding(wideViewport, sidebarCollapsedRef.current))
    else instance.fitBounds(bounds)
    clampFitZoomOnIdle(instance)
  }, [areas, fitAreaId, status, showPublicAreas, wideViewport])

  const changeZoom = (delta: number) => map.current?.setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (map.current.getZoom() ?? zoom) + delta)))
  const reset = () => { cancelLocationRequest(); setLocationStatus(''); map.current?.setCenter(JAPAN); map.current?.setZoom(INITIAL_ZOOM) }
  const locate = () => {
    if (locating) return
    const geolocation = navigator.geolocation
    if (!geolocation?.getCurrentPosition) { setLocationStatus('この端末では現在地を取得できません。'); return }
    const request = ++locationRequest.current
    const requestedMap = map.current
    setLocationStatus('現在地を取得しています…')
    setLocating(true)
    const settle = (message: string) => {
      if (request !== locationRequest.current) return
      locationRequest.current += 1
      window.clearTimeout(locationTimer.current)
      locationTimer.current = undefined
      setLocating(false)
      setLocationStatus(withLocationNotice(message))
    }
    locationTimer.current = window.setTimeout(() => settle('現在地を取得できませんでした。もう一度お試しください。'), LOCATION_DEADLINE_MS)
    try {
      geolocation.getCurrentPosition((position) => {
        if (request !== locationRequest.current) return
        const { latitude, longitude } = position.coords
        if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
          settle('現在地を取得できませんでした。もう一度お試しください。')
          return
        }
        if (!requestedMap || map.current !== requestedMap) { settle('現在地を取得できませんでした。もう一度お試しください。'); return }
        requestedMap.setCenter({ lat: latitude, lng: longitude })
        requestedMap.setZoom(LOCATION_ZOOM)
        setCurrentLocation({ lat: latitude, lng: longitude })
        settle(LOCATION_SUCCESS_MESSAGE)
      }, (error) => {
        const message = error.code === 1 ? '位置情報が許可されませんでした。ブラウザが再確認を表示しない場合は、アドレスバーのサイト情報から位置情報を「確認」または「許可」に変更して、もう一度お試しください。'
          : error.code === 3 ? '現在地を取得できませんでした。もう一度お試しください。'
            : '現在地を取得できません。位置情報を確認して、もう一度お試しください。'
        settle(message)
      }, { enableHighAccuracy: false, maximumAge: 0, timeout: LOCATION_DEADLINE_MS })
    } catch { settle('現在地を取得できません。位置情報を確認して、もう一度お試しください。') }
  }

  // ピン以外（地域セレクト等）で別の地域が選ばれたら、ピンのハイライトは外れたものとして扱う。
  const effectivePinAreaId = pinAreaId && (!selectedAreaId || selectedAreaId === pinAreaId) ? pinAreaId : null
  const highlightArea = effectivePinAreaId ? areas.find((area) => area.areaId === effectivePinAreaId) : undefined
  // 地図上に小さく浮かせる地域名チップの対象。ピンのフォーカスを優先し、無ければ
  // フィット対象の地域（選択中の地域、または選択中の問題の所属地域）にする。
  const focusArea = highlightArea ?? areas.find((area) => area.areaId === fitAreaId)
  // 一覧は選択（地域・地方の絞り込み）だけに連動し、地図の表示範囲では変わらない（D-45）。
  // 絞り込みは呼び出し側が済ませた quests をそのまま並べる。
  // 地図が使える時は全画面マップ＋ボトムシート、使えない時は従来どおり地図下の全件リスト。
  // シート表示は問題の件数に依存させない。絞り込みで0件になってもシートと全画面を維持し、空表示を出す。
  // （sheetMode／panelMode の定義は、フィット系のコールバックが使うため前方の
  // フィット共通処理の前に置く。）
  const [browseBelowMap, setBrowseBelowMap] = useState(false)
  const belowMap = sheetMode && !panelMode && browseBelowMap
  const belowMapList = useRef<HTMLElement>(null)
  const mapShell = useRef<HTMLDivElement>(null)
  const mapControlGesture = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null)
  const mapControlGestureProps = {
    onPointerDownCapture: (event: ReactPointerEvent<HTMLElement>) => {
      mapControlGesture.current = event.pointerType === 'touch'
        ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
        : null
    },
    onPointerMoveCapture: (event: ReactPointerEvent<HTMLElement>) => {
      const gesture = mapControlGesture.current
      if (gesture?.pointerId === event.pointerId && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8) gesture.moved = true
    },
    onPointerCancelCapture: () => { mapControlGesture.current = null },
    onClickCapture: (event: ReactMouseEvent<HTMLElement>) => {
      const gesture = mapControlGesture.current
      mapControlGesture.current = null
      // タッチスワイプ後に合成される誤クリックだけを抑え、タップとキーボード操作は残す。
      if (gesture?.moved && event.detail !== 0) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
  }
  const [pastMap, setPastMap] = useState(false)
  const updateMapScrollPosition = useCallback(() => {
    const bottom = mapShell.current?.getBoundingClientRect().bottom
    setPastMap(bottom !== undefined && bottom <= mobileHeaderClearance() + 1)
  }, [])
  useEffect(() => {
    const update = updateMapScrollPosition
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [sheetMode, panelMode, belowMap, updateMapScrollPosition])
  useEffect(() => {
    if (!belowMap) return
    focusQuestDestination(questScrollTarget?.current, belowMapList.current)
    updateMapScrollPosition()
  }, [belowMap, questScrollTarget, updateMapScrollPosition])

  const returnToMap = () => {
    setBrowseBelowMap(false)
    mapShell.current?.focus({ preventScroll: true })
    mapShell.current?.scrollIntoView?.({ block: 'start' })
  }
  const browseQuests = () => {
    if (!belowMap) {
      setBrowseBelowMap(true)
      return
    }
    focusQuestDestination(questScrollTarget?.current, belowMapList.current)
    updateMapScrollPosition()
  }

  // 詳細（questDetail）は一覧の選択中の行の直下にだけ差し込む。同時に2か所へは出さない
  // （状態を持つ詳細が二重にマウントされるのを避けるため）。地図下の一覧を開いている間は
  // そちらへ寄せ、「問題を見る」の着地（#70）が地図下の詳細になるようにする。
  // 読み込み中の一覧（仮の行）は、最終的な置き場所であるシート／パネルの中でのみ出す。
  // 地図の読み込み中に通常フロー側へ先に出すと、地図の準備完了で置き場所が移り、
  // 一覧が作り直されて見た目が跳ねるため。
  const renderQuestList = (scrollToHighlight = true, withDetail = false, inSheetOrPanel = false) => showPublicAreas && (sheetMode || quests.length > 0 || (inSheetOrPanel && questsLoading)) ? <ExploreQuestList areas={areas} quests={quests} loading={questsLoading}
    highlightArea={highlightArea} selectedQuestId={selectedQuestId} clearedQuestIds={clearedQuestIds}
    scrollToHighlight={scrollToHighlight}
    detailContent={withDetail ? questDetail : undefined} detailRef={questScrollTarget}
    onOpenQuest={onOpenQuest} onDeselectQuest={onDeselectQuest} /> : null
  // 境界データの出典表記（N03 の利用条件）。短い文言で、パネル／シートの一番下に小さく出す（D-46）。
  // 登録年度が公開応答に載っている地域があれば、その年度を出典に含める（D-71）。
  const boundaryYears = [...new Set(areas.flatMap((area) => area.boundary?.source === 'N03' ? [area.boundary.year] : []))].sort((a, b) => a - b)
  const boundaryCreditText = boundaryYears.length === 1
    ? `境界データ：国土数値情報N03-${boundaryYears[0]}（国土交通省）`
    : boundaryYears.length > 1
      ? `境界データ：国土数値情報N03（${boundaryYears.join('・')}年版、国土交通省）`
      : '境界データ：国土数値情報N03（国土交通省）'
  const boundaryCredit = showBoundaryCredit && showPublicAreas
    ? <p className="map-boundary-credit">{boundaryCreditText}</p>
    : null
  const mapControls = status === 'ready' ? <div className="map-controls" {...mapControlGestureProps}>
    <div className="map-zoom" aria-label="地図の表示操作">
      <div className="map-zoom-group">
        <button type="button" aria-label="地図を拡大" disabled={zoom >= MAX_ZOOM} onClick={() => changeZoom(1)}><Icon name="plus" /></button>
        <button type="button" aria-label="地図を縮小" disabled={zoom <= MIN_ZOOM} onClick={() => changeZoom(-1)}><Icon name="minus" /></button>
        <button type="button" aria-label="地図の表示を戻す" onClick={reset}><Icon name="reset" /></button>
      </div>
    </div>
    <button type="button" className="map-locate-fab" aria-label="現在地へ戻る" title="現在地へ戻る" disabled={locating} onClick={locate}><Icon name="locate" /></button>
  </div> : null

  // シート表示の間は、スマホ幅で探索画面を画面全体（縁なし）にするための目印を付ける。
  // シェル側（ヘッダー・下部ナビ等）の浮動配置は App.css がこのクラスとメディアクエリで切り替える。
  // 記録画面の表示中（viewActive でない間）は探索が前面にないため付けない。
  useEffect(() => {
    if (!sheetMode || !viewActive) return
    document.body.classList.add('explore-fullbleed')
    return () => { document.body.classList.remove('explore-fullbleed') }
  }, [sheetMode, viewActive])

  // シート表示かどうかを呼び出し側へ知らせる（D-43）。コールバックの同一性に依存しないよう
  // ref 経由で最新のものを呼び、アンマウント時は「地図は使えない」側へ戻す。地図が無い画面
  // （記録画面や、フォールバックが本文になる永続側）でピッカーが消えたままにならないため。
  const sheetModeChangeRef = useRef(onSheetModeChange)
  useEffect(() => { sheetModeChangeRef.current = onSheetModeChange }, [onSheetModeChange])
  useEffect(() => { sheetModeChangeRef.current?.(sheetMode && viewActive) }, [sheetMode, viewActive])
  useEffect(() => () => { sheetModeChangeRef.current?.(false) }, [])

  // 隠れていた探索が前面に戻ったら、地図コンテナの大きさが戻る。Google Maps は
  // 中心・ズームを保持するため、サイズの再認識だけを促せば表示が復帰する。
  const wasViewActive = useRef(viewActive)
  useEffect(() => {
    const becameActive = viewActive && !wasViewActive.current
    wasViewActive.current = viewActive
    if (!becameActive || !sheetMode) return
    const instance = map.current
    if (!instance) return
    try { window.google?.maps?.event.trigger?.(instance, 'resize') } catch { /* サイズ再認識は補助であり、失敗しても地図は使える。 */ }
  }, [viewActive, sheetMode])

  // レイアウトが確定する遷移（全画面化・サイドバー方式への切替）では地図コンテナの
  // 大きさが変わる。コンテナ確定前に走ったフィットは実サイズに合わず、選択中なのに
  // 初期表示のまま残ることがある（2026-11-08 の実機報告）。確定後にサイズの再認識を
  // 促し、未フィットの選択があればフィットをやり直す。
  // サイドバーの開閉はフローティング化（D-38）でコンテナの大きさが変わらなくなったため、
  // ここでの対象に含めない（開閉では resize も再フィットもしない）。
  useEffect(() => {
    if (!sheetMode) return
    const instance = map.current
    if (!instance) return
    const signature = `${sheetMode}:${panelMode}`
    const signatureChanged = settledLayout.current !== signature
    if (signatureChanged) {
      settledLayout.current = signature
      try { window.google?.maps?.event.trigger?.(instance, 'resize') } catch { /* サイズ再認識は補助であり、失敗しても地図は使える。 */ }
    }
    const alreadyFitted = lastViewportSelection.current?.map === instance && lastViewportSelection.current.key === fitKey
    if (fitAreaId && !alreadyFitted) {
      lastViewportSelection.current = null
      setFitRequest((value) => value + 1)
    } else if (!fitAreaId && signatureChanged && initialFitDone.current === instance && initialFitSignature.current !== signature) {
      // 未選択の初期フィットがレイアウト確定前の大きさで走っていたら、確定後の実サイズで
      // 合わせ直す（D-72）。マーカーは作り直さず、フィットだけを掛け直す。確定と同じ
      // シグネチャでフィット済みなら何もしない（利用者の操作を邪魔しない）。
      fitInitialAreas(instance)
    }
  }, [sheetMode, panelMode, fitKey, fitAreaId, fitInitialAreas])

  // サイドバーの開閉はシェル側（浮動カードの表示／非表示）にも効かせるため、
  // body のクラスで CSS と協調する。フィット用に現在の開閉状態も ref へ写す。
  // 探索が前面にない間はクラスを外すが、開閉状態そのものは保持する。
  useEffect(() => {
    if (!panelMode) return
    sidebarCollapsedRef.current = sidebarCollapsed
    if (!viewActive) return
    document.body.classList.toggle('explore-sidebar-collapsed', sidebarCollapsed)
    return () => { document.body.classList.remove('explore-sidebar-collapsed') }
  }, [panelMode, sidebarCollapsed, viewActive])

  return (<>
    <div ref={mapShell} tabIndex={-1} className={'map-preview-shell' + (sheetMode ? ' has-sheet' : '') + (belowMap ? ' is-browsing-below-map' : '')}
      style={sheetMode ? { '--sheet-h': `${panelMode ? 0 : sheetHeight}px` } as CSSProperties : undefined}>
    <section className="map-preview" aria-label="全国の謎">
      {status === 'ready' && !panelMode && (topOverlay || focusArea) && <div className="map-filter-overlay">{topOverlay}{focusArea && <div className="map-topline"><div className="map-topline-main"><span className="map-area-chip"><Icon name="pin" />{focusArea.label}</span></div></div>}</div>}
      {status === 'ready' && panelMode && focusArea && <div className="map-topline is-sidebar"><div className="map-topline-main"><span className="map-area-chip"><Icon name="pin" />{focusArea.label}</span></div></div>}
      {API_KEY && <div ref={target} className="google-map-canvas" aria-label="日本地図" />}
      {status !== 'ready' && <div className="map-state" role={status === 'error' || status === 'auth-error' ? 'alert' : 'status'} {...mapControlGestureProps}>
        {status === 'missing' ? <><strong>Google Mapsの設定が必要です</strong><span>地図を表示するには設定をご確認ください。問題の閲覧は続けられます。</span></> :
          status === 'loading' ? <span>地図を読み込んでいます…</span> :
            <><strong>地図を読み込めませんでした</strong><span>問題の閲覧は続けられます。</span>{status === 'auth-error'
              ? <><span>地図の設定を確認して、このページを再読み込みしてください。</span><button type="button" onClick={() => window.location.reload()}>ページを再読み込み</button></>
              : <button type="button" onClick={() => { setStatus('loading'); setAttempt((value) => value + 1) }}>地図を再試行</button>}</>}
      </div>}
      {status === 'ready' && areaFailed && <div className="map-state map-area-error" role="alert" {...mapControlGestureProps}><strong>地域エリアを表示できませんでした</strong><button type="button" onClick={() => { window.clearTimeout(areaFailureTimer.current); areaFailureTimer.current = undefined; setAreaFailed(false); setAreaAttempt((value) => value + 1) }}>地域エリアを再試行</button></div>}
      {!sheetMode && mapControls}
      {status === 'ready' && <output className="sr-only" aria-label="地図の表示倍率">{zoom}</output>}
    </section>
      {/* 地図の独立レイヤーより上で操作できるよう、シート時はシェル直下に置く。 */}
      {sheetMode && mapControls}
      {/* 地図が使えない時は浮かせず、地図の下に通常フローで出して絞り込み自体は失わせない。 */}
      {status !== 'ready' && topOverlay && <div className="map-filter-flow">{topOverlay}</div>}
      {status === 'ready' && locationStatus && <div className={'map-location-status' + (sheetMode ? ' is-floating' : '')} role="status"><span>{locationStatus}</span><button type="button" className="map-location-status-close" aria-label="位置情報の表示を閉じる" onClick={() => setLocationStatus('')}>×</button></div>}
      {sheetMode
        ? panelMode
          ? <>
            <div className="explore-side-panel">{topOverlay && <div className="side-panel-filters">{topOverlay}</div>}{renderQuestList(true, true, true)}{panelExtra}{boundaryCredit}</div>
            <button type="button" className="sidebar-toggle" aria-expanded={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? 'サイドバーを開く' : 'サイドバーを閉じる'}
              onClick={() => setSidebarCollapsed((value) => !value)}>
              <span aria-hidden="true">{sidebarCollapsed ? '›' : '‹'}</span>
            </button>
          </>
          : <ExploreBottomSheet openSignal={effectivePinAreaId ?? (selectedQuestId ? `quest:${selectedQuestId}` : null)} onHeightChange={setSheetHeight}
            onBrowseBelowMap={browseQuests}>{renderQuestList(true, !belowMap, true)}{boundaryCredit}</ExploreBottomSheet>
        : <>{renderQuestList(true, true)}{boundaryCredit}{panelExtra}</>}
    </div>
    {sheetMode && !panelMode && (pastMap || sheetHeight > SHEET_PEEK_HEIGHT) && <button type="button" {...mapControlGestureProps}
      className={'explore-sheet-reopen map-browse-shortcut' + (pastMap ? ' is-return-to-map' : '')}
      inert={!pastMap && sheetHeight > 48} aria-hidden={!pastMap && sheetHeight > 48} disabled={!pastMap && sheetHeight > 48}
      onClick={pastMap ? returnToMap : browseQuests}>{pastMap ? '地図に戻る' : '問題を見る'}</button>}
    {belowMap && <section ref={belowMapList} className="below-map-quests" tabIndex={-1} aria-label="地図の下の問題一覧">
      {renderQuestList(false, true)}
      {boundaryCredit}
    </section>}
  </>)
}
