import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import type { PublicArea, PublicQuest } from '../../shared/api/types'
import { ExploreBottomSheet, SHEET_PEEK_HEIGHT } from './ExploreBottomSheet'
import { ExploreQuestList } from './ExploreQuestList'
import { loadGoogleMaps, subscribeMapsAuthFailure, type DataLayer, type MapInstance, type MarkerInstance } from './googleMapsLoader'
import { MAP_PIN_COLOR as PIN_COLOR, MAP_PIN_SELECTED_COLOR as PIN_SELECTED_COLOR, MAP_PIN_STROKE as PIN_STROKE, MAP_STYLES } from './mapStyles'
import { areaPinPosition, questsInViewport, type ViewportBounds } from './viewportQuests'

const JAPAN = { lat: 36.2048, lng: 138.2529 }
const MIN_ZOOM = 3
const INITIAL_ZOOM = 5
const MAX_ZOOM = 20
const LOCATION_ZOOM = 14
const LOCATION_DEADLINE_MS = 10_000
const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''

function pinIcon(color: string, count: number): { url: string } {
  const center = count >= 2
    ? `<circle cx="18" cy="17" r="9.5" fill="#ffffff"/><text x="18" y="21.5" text-anchor="middle" font-family="sans-serif" font-size="${count >= 10 ? 10 : 12}" font-weight="700" fill="${PIN_STROKE}">${count}</text>`
    : '<circle cx="18" cy="17" r="7" fill="#ffffff"/>'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44"><path d="M18 1C9.2 1 2 8.2 2 17c0 10.5 16 26 16 26s16-15.5 16-26C34 8.2 26.8 1 18 1Z" fill="${color}" stroke="${PIN_STROKE}" stroke-width="2"/>${center}</svg>`
  return { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}` }
}

const LOCATION_SUCCESS_MESSAGE = '現在地を地図の中心に表示しました。'

export function MapPreview({ areas = [], selectedAreaId = '', onSelectArea, showPublicAreas = true, quests = [], onOpenQuest, selectedQuestId = '', clearedQuestIds, topOverlay }: {
  areas?: PublicArea[]; selectedAreaId?: string; onSelectArea?: (areaId: string) => void; showPublicAreas?: boolean
  quests?: PublicQuest[]; onOpenQuest?: (questId: string) => void; selectedQuestId?: string; clearedQuestIds?: ReadonlySet<string>
  /** 地図の上部に浮かせて出す操作（地方・都道府県フィルタ等）。地図が使えない時は地図下の通常フローに出す。 */
  topOverlay?: ReactNode
}) {
  const target = useRef<HTMLDivElement>(null)
  const map = useRef<MapInstance | null>(null)
  const dataLayer = useRef<DataLayer | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error' | 'auth-error'>(API_KEY ? 'loading' : 'missing')
  const [zoom, setZoom] = useState(INITIAL_ZOOM)
  const [locationStatus, setLocationStatus] = useState('')
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null)

  useEffect(() => {
    if (locationStatus !== LOCATION_SUCCESS_MESSAGE) return
    const timeout = window.setTimeout(() => setLocationStatus(''), 5000)
    return () => window.clearTimeout(timeout)
  }, [locationStatus])
  const [locating, setLocating] = useState(false)
  const locationRequest = useRef(0)
  const locationTimer = useRef<number | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)

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
  const [viewport, setViewport] = useState<ViewportBounds | null>(null)
  const viewportRef = useRef<ViewportBounds | null>(null)
  const lastViewportSelection = useRef<{ map: MapInstance; areaId: string } | null>(null)
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
      layer.setStyle((feature) => ({
        fillColor: feature.getProperty('areaId') === selectedAreaId ? PIN_SELECTED_COLOR : PIN_COLOR,
        fillOpacity: feature.getProperty('areaId') === selectedAreaId ? 0.55 : 0.25,
        strokeColor: PIN_STROKE, strokeOpacity: 0.9, strokeWeight: feature.getProperty('areaId') === selectedAreaId ? 3 : 1.5,
        clickable: true,
      }))
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
  }, [areas, selectedAreaId, onSelectArea, showPublicAreas, status, areaAttempt])

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
        const marker = new google.Marker({
          position, map: instance,
          title: `${area.label}の探索エリア（${area.publishedCount}問）`,
          icon: pinIcon(selected ? PIN_SELECTED_COLOR : PIN_COLOR, area.publishedCount),
          zIndex: selected ? 2 : 1,
        })
        listeners.push(marker.addListener('click', () => {
          if (!active) return
          setPinAreaId(area.areaId)
          onSelectArea?.(area.areaId)
        }))
        created.push(marker)
      }
    } catch { /* ピンは補助表示のため、失敗しても地図本体は使える状態を保つ。 */ }
    return () => {
      active = false
      for (const listener of listeners) { try { listener.remove() } catch { /* SDK teardown is best effort. */ } }
      for (const marker of created) { try { marker.setMap(null) } catch { /* SDK teardown is best effort. */ } }
    }
  }, [areas, selectedAreaId, onSelectArea, showPublicAreas, status, areaAttempt, attempt])

  useEffect(() => {
    const instance = map.current
    const google = window.google?.maps
    if (!API_KEY || !instance || !google || !showPublicAreas || status !== 'ready') return
    if (lastAreaSelection.current?.map === instance && lastAreaSelection.current.areaId !== selectedAreaId) cancelLocationRequest()
    lastAreaSelection.current = { map: instance, areaId: selectedAreaId }
    if (lastViewportSelection.current?.map === instance && lastViewportSelection.current.areaId === selectedAreaId) return
    if (!selectedAreaId) { instance.setCenter(JAPAN); instance.setZoom(INITIAL_ZOOM); lastViewportSelection.current = { map: instance, areaId: '' }; return }
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
      instance.fitBounds(bounds)
      lastViewportSelection.current = { map: instance, areaId: selectedAreaId }
    } catch { failArea() }
  }, [selectedAreaId, areas, showPublicAreas, status, areaAttempt])

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
      setLocationStatus(message)
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
  const visibleQuests = status === 'ready' ? questsInViewport(areas, quests, viewport) : quests
  // 地図が使える時は全画面マップ＋ボトムシート、使えない時は従来どおり地図下の全件リスト。
  const sheetMode = status === 'ready' && showPublicAreas && quests.length > 0
  const questList = showPublicAreas && quests.length > 0 ? <ExploreQuestList areas={areas} quests={visibleQuests} variant={status === 'ready' ? 'viewport' : 'fallback'}
    highlightArea={highlightArea} selectedQuestId={selectedQuestId} clearedQuestIds={clearedQuestIds}
    onOpenQuest={onOpenQuest} onClearHighlight={() => setPinAreaId(null)} /> : null

  return (
    <div className={'map-preview-shell' + (sheetMode ? ' has-sheet' : '')}
      style={sheetMode ? { '--sheet-h': `${sheetHeight}px` } as CSSProperties : undefined}>
    <section className="map-preview" aria-label="全国の謎">
      <div className="map-topline"><span className="map-scope"><Icon name="map" />全国の謎</span>{status === 'ready' && <div className="map-location-action"><span>位置情報はGoogle Mapsに送信されます</span></div>}</div>
      {status === 'ready' && topOverlay && <div className="map-filter-overlay">{topOverlay}</div>}
      {API_KEY && <div ref={target} className="google-map-canvas" aria-label="日本地図" />}
      {status !== 'ready' && <div className="map-state" role={status === 'error' || status === 'auth-error' ? 'alert' : 'status'}>
        {status === 'missing' ? <><strong>Google Mapsの設定が必要です</strong><span>地図を表示するには設定をご確認ください。問題の閲覧は続けられます。</span></> :
          status === 'loading' ? <span>地図を読み込んでいます…</span> :
            <><strong>地図を読み込めませんでした</strong><span>問題の閲覧は続けられます。</span>{status === 'auth-error'
              ? <><span>地図の設定を確認して、このページを再読み込みしてください。</span><button type="button" onClick={() => window.location.reload()}>ページを再読み込み</button></>
              : <button type="button" onClick={() => { setStatus('loading'); setAttempt((value) => value + 1) }}>地図を再試行</button>}</>}
      </div>}
      {status === 'ready' && areaFailed && <div className="map-state map-area-error" role="alert"><strong>地域エリアを表示できませんでした</strong><button type="button" onClick={() => { window.clearTimeout(areaFailureTimer.current); areaFailureTimer.current = undefined; setAreaFailed(false); setAreaAttempt((value) => value + 1) }}>地域エリアを再試行</button></div>}
      {status === 'ready' && <div className="map-controls">
        <div className="map-zoom" aria-label="地図の表示操作">
          <div className="map-zoom-group">
          <button type="button" aria-label="地図を拡大" disabled={zoom >= MAX_ZOOM} onClick={() => changeZoom(1)}><Icon name="plus" /></button>
          <button type="button" aria-label="地図を縮小" disabled={zoom <= MIN_ZOOM} onClick={() => changeZoom(-1)}><Icon name="minus" /></button>
          <button type="button" aria-label="地図の表示を戻す" onClick={reset}><Icon name="reset" /></button>
          </div>
        </div>
        <button type="button" className="map-locate-fab" aria-label="現在地へ戻る" title="現在地へ戻る" disabled={locating} onClick={locate}><Icon name="locate" /></button>
      </div>}
      {status === 'ready' && <output className="sr-only" aria-label="地図の表示倍率">{zoom}</output>}
    </section>
      {/* 地図が使えない時は浮かせず、地図の下に通常フローで出して絞り込み自体は失わせない。 */}
      {status !== 'ready' && topOverlay && <div className="map-filter-flow">{topOverlay}</div>}
      {status === 'ready' && locationStatus && <div className={'map-location-status' + (sheetMode ? ' is-floating' : '')} role="status">{locationStatus}</div>}
      {sheetMode
        ? <ExploreBottomSheet openSignal={effectivePinAreaId} onHeightChange={setSheetHeight}>{questList}</ExploreBottomSheet>
        : questList}
    </div>
  )
}
