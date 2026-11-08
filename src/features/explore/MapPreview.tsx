import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import type { PublicArea, PublicQuest } from '../../shared/api/types'
import { useWideViewport } from '../quests/useWideViewport'
import { ExploreBottomSheet, SHEET_PEEK_HEIGHT } from './ExploreBottomSheet'
import { visibleAreaFitPadding } from './fitPadding'
import { ExploreQuestList } from './ExploreQuestList'
import { loadGoogleMaps, subscribeMapsAuthFailure, type DataLayer, type MapInstance, type MarkerInstance, type PolygonInstance } from './googleMapsLoader'
import { buildJapanVeilPaths } from './japanOutline'
import { MAP_PIN_ACTIVE_COLOR as PIN_ACTIVE_COLOR, MAP_PIN_COLOR as PIN_COLOR, MAP_PIN_SELECTED_COLOR as PIN_SELECTED_COLOR, MAP_PIN_STROKE as PIN_STROKE, MAP_STYLES } from './mapStyles'
import { areaPinPosition, questsInViewport, type ViewportBounds } from './viewportQuests'

const JAPAN = { lat: 36.2048, lng: 138.2529 }
// 日本国内専用（D-27／D-41）：地図の移動範囲を日本の周辺に制限する。strictBounds は使わず、端では柔らかく止める。
// 境界は日本の領土（北端の宗谷岬45.5度・南端の波照間島24.1度・西端の与那国島123.0度・東端の納沙布岬145.8度）が
// すべて収まり、10のデモ地域と郡山の代表点からも緯度3度・経度5度以上の余裕がある範囲に絞った（D-41）。
const JAPAN_BOUNDS = { north: 46.5, south: 23, east: 147, west: 122 }
// これ以上引くと日本が小さくなりすぎるため、最小ズームも引き上げる（D-41）。
// 初期表示の日本全体フィットは小さい画面でも 4.5 を下回らないため、その下限に合わせる。
const MIN_ZOOM = 4.5
// 日本の外側を薄く落とすベール（D-41）。日本周辺を覆う外周リングから日本の輪郭（japanOutline）を
// 穴としてくり抜いたポリゴンを、ベースタイルより上・地域の塗りとピンより下に重ねる。
// 消すのではなく沈める濃さにする。外周を世界全体の矩形にすると球面上で内側が反転するため、
// 外周の範囲と巻き方向は japanOutline 側で構造として担保する（buildJapanVeilPaths）。
const OUTSIDE_JAPAN_VEIL_COLOR = '#3f4a56'
const OUTSIDE_JAPAN_VEIL_OPACITY = 0.38
const INITIAL_ZOOM = 5
const MAX_ZOOM = 20
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

const LOCATION_SUCCESS_MESSAGE = '現在地を地図の中心に表示しました。'

export function MapPreview({ areas = [], selectedAreaId = '', onSelectArea, showPublicAreas = true, quests = [], onOpenQuest, selectedQuestId = '', clearedQuestIds, topOverlay, showBoundaryCredit = false, fillSelectedAreaOnly = false, panelExtra, onSheetModeChange }: {
  areas?: PublicArea[]; selectedAreaId?: string; onSelectArea?: (areaId: string) => void; showPublicAreas?: boolean
  quests?: PublicQuest[]; onOpenQuest?: (questId: string) => void; selectedQuestId?: string; clearedQuestIds?: ReadonlySet<string>
  /** シート表示（地図が使えてカード一覧が出ている状態）かどうかを呼び出し側へ知らせる。
      問題の選択手段の出し分け（地図が使える間はカード一覧に一本化し、全件ピッカーは
      地図が使えないフォールバック専用にする、D-43）に使う。 */
  onSheetModeChange?: (sheetMode: boolean) => void
  /** PC幅で地図の下に出ていた内容（問題の選択・詳細・注意書き）をサイドバーのパネル内へ寄せるための追加コンテンツ。
      パネル表示ではサイドバー内、地図が使えない時は通常フローのリスト末尾に出す。シート表示（スマホ幅）では出さない。 */
  panelExtra?: ReactNode
  /** 境界データの出典（国土数値情報 N03）をシート内に小さく出す。共有検証サイトの探索地図でのみ有効にする。 */
  showBoundaryCredit?: boolean
  /** 地域の塗りを「選択中の地域だけ」にする（D-29）。共有検証サイトの探索地図でのみ有効にする。 */
  fillSelectedAreaOnly?: boolean
  /** 地図の上部に浮かせて出す操作（地方・都道府県フィルタ等）。地図が使えない時は地図下の通常フローに出す。 */
  topOverlay?: ReactNode
}) {
  const target = useRef<HTMLDivElement>(null)
  const map = useRef<MapInstance | null>(null)
  const veil = useRef<PolygonInstance | null>(null)
  const dataLayer = useRef<DataLayer | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error' | 'auth-error'>(API_KEY ? 'loading' : 'missing')
  // PC幅（981px以上）ではボトムシートを使わず、左サイドバーのパネルに一覧を出す（D-34）。
  const wideViewport = useWideViewport()
  const [zoom, setZoom] = useState(INITIAL_ZOOM)
  const [locationStatus, setLocationStatus] = useState('')
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null)

  useEffect(() => {
    if (!locationStatus.startsWith(LOCATION_SUCCESS_MESSAGE)) return
    const timeout = window.setTimeout(() => setLocationStatus(''), 5000)
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
  const [viewport, setViewport] = useState<ViewportBounds | null>(null)
  const viewportRef = useRef<ViewportBounds | null>(null)
  const lastViewportSelection = useRef<{ map: MapInstance; areaId: string } | null>(null)
  // 地域を選ぶ直前のカメラ（中心・ズーム）。選択を解除したら、初期表示ではなくこの状態へ戻す。
  const preSelectionCamera = useRef<{ map: MapInstance; center: { lat: number; lng: number }; zoom: number } | null>(null)
  const initialFitDone = useRef<MapInstance | null>(null)
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

  useEffect(() => {
    if (!API_KEY || !target.current) return
    let active = true
    let authFailed = false
    let zoomListener: { remove(): void } | undefined
    let idleListener: { remove(): void } | undefined
    viewportRef.current = null
    setViewport(null)
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
          restriction: { latLngBounds: JAPAN_BOUNDS, strictBounds: false },
          disableDefaultUI: true, mapTypeControl: false, streetViewControl: false,
          fullscreenControl: false, clickableIcons: false, gestureHandling: 'greedy',
          styles: MAP_STYLES,
        }) as MapInstance
        if (authFailed) return
        map.current = instance
        // 日本の外側を薄く落とすベールは、地域レイヤーより先に地図へ載せて下に置く（D-41）。
        // 装飾のため、作れなくても地図本体は使える状態を保つ。
        try {
          if (google.Polygon) {
            const japanVeil = new google.Polygon({
              paths: buildJapanVeilPaths(),
              fillColor: OUTSIDE_JAPAN_VEIL_COLOR, fillOpacity: OUTSIDE_JAPAN_VEIL_OPACITY,
              strokeWeight: 0, clickable: false,
            })
            japanVeil.setMap(instance)
            veil.current = japanVeil
          }
        } catch { /* ベールが表示できなくても地図は利用できる。 */ }
        try {
          const layer = new google.Data()
          layer.setMap(instance)
          dataLayer.current = layer
        } catch { failArea() }
        idleListener = instance.addListener('idle', () => {
          if (!active) return
          try {
            const bounds = instance.getBounds?.()
            if (!bounds) return
            const northEast = bounds.getNorthEast()
            const southWest = bounds.getSouthWest()
            const next = { north: northEast.lat(), south: southWest.lat(), east: northEast.lng(), west: southWest.lng() }
            if (![next.north, next.south, next.east, next.west].every(Number.isFinite)) return
            const previous = viewportRef.current
            if (previous && Math.abs(previous.north - next.north) < 1e-9 && Math.abs(previous.south - next.south) < 1e-9
              && Math.abs(previous.east - next.east) < 1e-9 && Math.abs(previous.west - next.west) < 1e-9) return
            viewportRef.current = next
            setViewport(next)
          } catch { /* 表示範囲が読めない間は全件表示を維持する。 */ }
        })
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
      try { idleListener?.remove() } catch { /* SDK teardown is best effort. */ }
      try { veil.current?.setMap(null) } catch { /* SDK teardown is best effort. */ }
      veil.current = null
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
        if (active && typeof areaId === 'string' && areas.some((area) => area.areaId === areaId)) { setPinAreaId(null); onSelectArea?.(areaId) }
      })
    } catch {
      active = false
      try { listener?.remove(); layer.setMap(null); layer.forEach((feature) => layer.remove(feature)) } catch { /* Keep the base map usable. */ }
      failArea()
    }
    return () => { active = false; window.clearTimeout(areaFailureTimer.current); areaFailureTimer.current = undefined; try { listener?.remove(); layer.setMap(null) } catch { /* SDK teardown is best effort. */ } }
  }, [areas, selectedAreaId, onSelectArea, showPublicAreas, status, areaAttempt, fillSelectedAreaOnly])

  useEffect(() => {
    const instance = map.current
    const google = window.google?.maps
    if (!API_KEY || !instance || !google?.Marker || !showPublicAreas || status !== 'ready') return
    let active = true
    const created: MarkerInstance[] = []
    const listeners: Array<{ remove(): void }> = []
    try {
      for (const area of areas) {
        if (area.publishedCount < 1) continue
        const position = areaPinPosition(area)
        if (!position) continue
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
          // 選択中のピンをもう一度押したらハイライトを外す。選択自体の解除は呼び出し側が同じ地域の再選択として扱う。
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
      if (initialFitDone.current !== instance && !selectedAreaId && google.LatLngBounds) {
        const bounds = new google.LatLngBounds()
        let fitted = false
        for (const area of areas) {
          if (area.publishedCount < 1) continue
          const position = areaPinPosition(area)
          if (!position) continue
          bounds.extend(position)
          fitted = true
        }
        if (fitted) {
          instance.fitBounds(bounds, visibleAreaFitPadding(wideViewport, sidebarCollapsedRef.current))
          initialFitDone.current = instance
        }
      }
    } catch { /* ピンは補助表示のため、失敗しても地図本体は使える状態を保つ。 */ }
    return () => {
      active = false
      for (const listener of listeners) { try { listener.remove() } catch { /* SDK teardown is best effort. */ } }
      for (const marker of created) { try { marker.setMap(null) } catch { /* SDK teardown is best effort. */ } }
    }
  }, [areas, selectedAreaId, onSelectArea, showPublicAreas, status, areaAttempt, attempt, wideViewport])

  useEffect(() => {
    const instance = map.current
    const google = window.google?.maps
    if (!API_KEY || !instance || !google || !showPublicAreas || status !== 'ready') return
    if (lastAreaSelection.current?.map === instance && lastAreaSelection.current.areaId !== selectedAreaId) cancelLocationRequest()
    lastAreaSelection.current = { map: instance, areaId: selectedAreaId }
    if (lastViewportSelection.current?.map === instance && lastViewportSelection.current.areaId === selectedAreaId) return
    if (!selectedAreaId) {
      // 選択解除では初期表示へ戻さず、選択直前のカメラを復元する。選択後に手動で動かしていても、
      // 解除時は選択前の状態へ戻す（「選ぶ前の地図に戻る」を単純な仕様として採る）。
      const saved = preSelectionCamera.current
      if (saved && saved.map === instance) {
        instance.setCenter(saved.center)
        instance.setZoom(saved.zoom)
        preSelectionCamera.current = null
      } else {
        instance.setCenter(JAPAN); instance.setZoom(INITIAL_ZOOM)
      }
      lastViewportSelection.current = { map: instance, areaId: '' }
      return
    }
    // 未選択から選択へ移る時だけ、フィット直前のカメラを覚える。地域A→Bの切替では上書きせず、
    // 解除時に「最初に選ぶ前」の状態へ戻れるようにする。
    const previousSelection = lastViewportSelection.current
    if (!previousSelection || previousSelection.map !== instance || previousSelection.areaId === '') {
      try {
        const center = instance.getCenter?.()
        if (center) preSelectionCamera.current = { map: instance, center: { lat: center.lat(), lng: center.lng() }, zoom: instance.getZoom() ?? INITIAL_ZOOM }
      } catch { /* カメラが読めない時は復元を諦め、解除時は従来どおり初期表示へ戻す。 */ }
    }
    try {
      const area = areas.find((candidate) => candidate.areaId === selectedAreaId)
      if (!area) return
      const geometry = area.publicGeometry
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
      const validPolygons = polygons.filter((polygon) => polygon.length > 0 && polygon.every((ring) => {
        if (ring.length < 4) return false
        const validPoints = ring.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90)
        const [firstLng, firstLat] = ring[0]
        const [lastLng, lastLat] = ring[ring.length - 1]
        return validPoints && firstLng === lastLng && firstLat === lastLat
      }))
      if (!validPolygons.length) return
      const bounds = new google.LatLngBounds()
      validPolygons.forEach((polygon) => polygon.forEach((ring) => ring.forEach(([lng, lat]) => bounds.extend({ lat, lng }))))
      // 地図の上に重なる帯・チップ・シート等の分をパディングとして差し引き、選んだ地域が
      // 実際に見えている領域の中央に来るようにする。
      if (showPublicAreas) {
        instance.fitBounds(bounds, visibleAreaFitPadding(wideViewport, sidebarCollapsedRef.current))
        initialFitDone.current = instance
      } else instance.fitBounds(bounds)
      lastViewportSelection.current = { map: instance, areaId: selectedAreaId }
    } catch { failArea() }
  }, [selectedAreaId, areas, showPublicAreas, status, areaAttempt, wideViewport, fitRequest])

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
  // 地図上に小さく浮かせる地域名チップの対象。ピンのフォーカスを優先し、無ければ選択中の地域。
  const focusArea = highlightArea ?? areas.find((area) => area.areaId === selectedAreaId)
  const visibleQuests = status === 'ready' ? questsInViewport(areas, quests, viewport) : quests
  // 地図が使える時は全画面マップ＋ボトムシート、使えない時は従来どおり地図下の全件リスト。
  // シート表示は問題の件数に依存させない。絞り込みで0件になってもシートと全画面を維持し、空表示を出す。
  const sheetMode = status === 'ready' && showPublicAreas
  // PC幅ではシートの代わりに左サイドバーのパネルへ同じ一覧を出す（D-34）。全画面化の扱いはシートと同じ。
  const panelMode = sheetMode && wideViewport
  const questList = showPublicAreas && (sheetMode || quests.length > 0) ? <ExploreQuestList areas={areas} quests={visibleQuests} variant={sheetMode ? 'viewport' : 'fallback'}
    highlightArea={highlightArea} selectedQuestId={selectedQuestId} clearedQuestIds={clearedQuestIds}
    onOpenQuest={onOpenQuest} onClearHighlight={() => setPinAreaId(null)}
    emptyText={sheetMode && quests.length === 0 ? '選択中の条件に合う謎はありません。地方・都道府県の条件を変えると、別の謎が表示されます。' : undefined} /> : null
  // 境界データの出典表記（N03 の利用条件）。シート内・フォールバックのリスト末尾に小さく出す。
  const boundaryCredit = showBoundaryCredit && showPublicAreas
    ? <p className="map-boundary-credit">境界データ：国土数値情報（行政区域データ）N03（国土交通省）をもとに作成</p>
    : null
  const mapControls = status === 'ready' ? <div className="map-controls">
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
  useEffect(() => {
    if (!sheetMode) return
    document.body.classList.add('explore-fullbleed')
    return () => { document.body.classList.remove('explore-fullbleed') }
  }, [sheetMode])

  // シート表示かどうかを呼び出し側へ知らせる（D-43）。コールバックの同一性に依存しないよう
  // ref 経由で最新のものを呼び、アンマウント時は「地図は使えない」側へ戻す。地図が無い画面
  // （記録画面や、フォールバックが本文になる永続側）でピッカーが消えたままにならないため。
  const sheetModeChangeRef = useRef(onSheetModeChange)
  useEffect(() => { sheetModeChangeRef.current = onSheetModeChange }, [onSheetModeChange])
  useEffect(() => { sheetModeChangeRef.current?.(sheetMode) }, [sheetMode])
  useEffect(() => () => { sheetModeChangeRef.current?.(false) }, [])

  // レイアウトが確定する遷移（全画面化・サイドバー方式への切替）では地図コンテナの
  // 大きさが変わる。コンテナ確定前に走ったフィットは実サイズに合わず、選択中なのに
  // 初期表示のまま残ることがある（2026-11-08 の実機報告）。確定後にサイズの再認識を
  // 促し、未フィットの選択があればフィットをやり直す。
  // サイドバーの開閉はフローティング化（D-38）でコンテナの大きさが変わらなくなったため、
  // ここでの対象に含めない（開閉では resize も再フィットもしない）。
  const settledLayout = useRef('')
  useEffect(() => {
    if (!sheetMode) return
    const instance = map.current
    if (!instance) return
    const signature = `${sheetMode}:${panelMode}`
    if (settledLayout.current !== signature) {
      settledLayout.current = signature
      try { window.google?.maps?.event.trigger?.(instance, 'resize') } catch { /* サイズ再認識は補助であり、失敗しても地図は使える。 */ }
    }
    const alreadyFitted = lastViewportSelection.current?.map === instance && lastViewportSelection.current.areaId === selectedAreaId
    if (selectedAreaId && !alreadyFitted) {
      lastViewportSelection.current = null
      setFitRequest((value) => value + 1)
    }
  }, [sheetMode, panelMode, selectedAreaId])

  // サイドバーの開閉はシェル側（浮動カードの表示／非表示）にも効かせるため、
  // body のクラスで CSS と協調する。フィット用に現在の開閉状態も ref へ写す。
  useEffect(() => {
    if (!panelMode) return
    sidebarCollapsedRef.current = sidebarCollapsed
    document.body.classList.toggle('explore-sidebar-collapsed', sidebarCollapsed)
    return () => { document.body.classList.remove('explore-sidebar-collapsed') }
  }, [panelMode, sidebarCollapsed])

  return (
    <div className={'map-preview-shell' + (sheetMode ? ' has-sheet' : '')}
      style={sheetMode ? { '--sheet-h': `${panelMode ? 0 : sheetHeight}px` } as CSSProperties : undefined}>
    <section className="map-preview" aria-label="全国の謎">
      <div className="map-topline"><div className="map-topline-main">{status === 'ready' && focusArea && <span className="map-area-chip"><Icon name="pin" />{focusArea.label}</span>}</div></div>
      {status === 'ready' && topOverlay && !panelMode && <div className="map-filter-overlay">{topOverlay}</div>}
      {API_KEY && <div ref={target} className="google-map-canvas" aria-label="日本地図" />}
      {status !== 'ready' && <div className="map-state" role={status === 'error' || status === 'auth-error' ? 'alert' : 'status'}>
        {status === 'missing' ? <><strong>Google Mapsの設定が必要です</strong><span>地図を表示するには設定をご確認ください。問題の閲覧は続けられます。</span></> :
          status === 'loading' ? <span>地図を読み込んでいます…</span> :
            <><strong>地図を読み込めませんでした</strong><span>問題の閲覧は続けられます。</span>{status === 'auth-error'
              ? <><span>地図の設定を確認して、このページを再読み込みしてください。</span><button type="button" onClick={() => window.location.reload()}>ページを再読み込み</button></>
              : <button type="button" onClick={() => { setStatus('loading'); setAttempt((value) => value + 1) }}>地図を再試行</button>}</>}
      </div>}
      {status === 'ready' && areaFailed && <div className="map-state map-area-error" role="alert"><strong>地域エリアを表示できませんでした</strong><button type="button" onClick={() => { window.clearTimeout(areaFailureTimer.current); areaFailureTimer.current = undefined; setAreaFailed(false); setAreaAttempt((value) => value + 1) }}>地域エリアを再試行</button></div>}
      {!sheetMode && mapControls}
      {status === 'ready' && <output className="sr-only" aria-label="地図の表示倍率">{zoom}</output>}
    </section>
      {/* 地図の独立レイヤーより上で操作できるよう、シート時はシェル直下に置く。 */}
      {sheetMode && mapControls}
      {/* 地図が使えない時は浮かせず、地図の下に通常フローで出して絞り込み自体は失わせない。 */}
      {status !== 'ready' && topOverlay && <div className="map-filter-flow">{topOverlay}</div>}
      {status === 'ready' && locationStatus && <div className={'map-location-status' + (sheetMode ? ' is-floating' : '')} role="status">{locationStatus}</div>}
      {sheetMode
        ? panelMode
          ? <>
            <div className="explore-side-panel">{topOverlay && <div className="side-panel-filters">{topOverlay}</div>}{questList}{boundaryCredit}{panelExtra}</div>
            <button type="button" className="sidebar-toggle" aria-expanded={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? 'サイドバーを開く' : 'サイドバーを閉じる'}
              onClick={() => setSidebarCollapsed((value) => !value)}>
              <span aria-hidden="true">{sidebarCollapsed ? '›' : '‹'}</span>
            </button>
          </>
          : <ExploreBottomSheet openSignal={effectivePinAreaId} onHeightChange={setSheetHeight}>{questList}{boundaryCredit}</ExploreBottomSheet>
        : <>{questList}{boundaryCredit}{panelExtra}</>}
    </div>
  )
}
