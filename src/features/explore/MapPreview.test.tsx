import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MapPreview } from './MapPreview'
import type { PublicArea, PublicQuest } from '../../shared/api/types'

const areas: PublicArea[] = [{ areaId: 'area-a', label: 'A', publishedCount: 1, marker: { latitude: 35, longitude: 139 },
  publicGeometry: { type: 'Polygon', coordinates: [[[139, 35], [140, 35], [140, 36], [139, 36], [139, 35]], [[139.2, 35.2], [139.3, 35.2], [139.3, 35.3], [139.2, 35.3], [139.2, 35.2]]] } }]

describe('Google map panel', () => {
  it('explains that a key is required while leaving problem browsing available', () => {
    render(<MapPreview />)
    expect(screen.getByText('Google Mapsの設定が必要です')).toBeVisible()
    expect(screen.getByText('地図を表示するには設定をご確認ください。問題の閲覧は続けられます。')).toBeVisible()
  })
  it('does not create quest markers from the currently selected sample', () => {
    render(<MapPreview />)
    expect(screen.queryByRole('button', { name: /謎を地図から見る/ })).not.toBeInTheDocument()
  })
  it('keeps the full quest list in normal flow without a sheet when the map is unavailable', () => {
    const quests: PublicQuest[] = [
      { questId: 'q1', version: 1, title: '港の時計台', clue: '大きな時計が見える場所', areaId: 'area-a', visitConditions: '', hintCount: 3 },
    ]
    const { container } = render(<MapPreview areas={areas} quests={quests} onOpenQuest={vi.fn()} />)
    expect(screen.getByRole('region', { name: '選べる謎の一覧' })).toBeVisible()
    expect(screen.getByRole('button', { name: '港の時計台の詳細を見る' })).toBeVisible()
    expect(container.querySelector('.explore-sheet')).not.toBeInTheDocument()
    expect(container.querySelector('.map-preview-shell')).not.toHaveClass('has-sheet')
  })
  it('keeps authentication failure visible when it occurs during map creation', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    window.google = { maps: {
      Map: class {
        constructor() { window.gm_authFailure?.(); return mapInstance }
      },
      Data: class { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} },
      event: { addListener: () => ({ remove() {} }) },
    } as never }
    try {
      const { unmount } = render(<ConfiguredMapPreview />)
      expect(await screen.findByRole('alert')).toHaveTextContent('地図を読み込めませんでした')
      expect(screen.queryByRole('button', { name: '地図を拡大' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'ページを再読み込み' })).toBeVisible()
      unmount()
      render(<ConfiguredMapPreview />)
      expect(await screen.findByRole('alert')).toHaveTextContent('地図の設定を確認して')
      expect(screen.queryByRole('button', { name: '地図を拡大' })).not.toBeInTheDocument()
    } finally { delete window.google }
  })

  it('renders public GeoJSON in longitude/latitude order with holes and selects only current features', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const addGeoJson = vi.fn()
    const setStyle = vi.fn()
    let click: ((event: { feature: { getProperty: () => string } }) => void) | undefined
    const removeFeature = vi.fn()
    class Data { setMap() {} addGeoJson = addGeoJson; setStyle = setStyle; addListener(_name: string, cb: typeof click) { click = cb; return { remove: removeFeature } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return mapInstance } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const onSelectArea = vi.fn()
    const { rerender, unmount } = render(<ConfiguredMapPreview areas={areas} onSelectArea={onSelectArea} />)
    expect(await screen.findByRole('button', { name: '地図を拡大' })).toBeVisible()
    await waitFor(() => expect(addGeoJson).toHaveBeenCalledWith(expect.objectContaining({ features: [expect.objectContaining({
      geometry: { type: 'Polygon', coordinates: areas[0].publicGeometry.coordinates },
    })] })))
    expect(setStyle).toHaveBeenCalled()
    click?.({ feature: { getProperty: () => 'area-a' } })
    expect(onSelectArea).toHaveBeenCalledWith('area-a')
    rerender(<ConfiguredMapPreview areas={[]} onSelectArea={onSelectArea} />)
    expect(removeFeature).toHaveBeenCalled()
    unmount()
    delete window.google
  })

  it('does not add demo areas to the map', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const addGeoJson = vi.fn()
    class Data { setMap() {} addGeoJson = addGeoJson; setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return mapInstance } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { unmount } = render(<ConfiguredMapPreview areas={areas} showPublicAreas={false} />)
    expect(await screen.findByRole('button', { name: '地図を拡大' })).toBeVisible()
    expect(addGeoJson).not.toHaveBeenCalled()
    unmount()
    delete window.google
  })

  it('keeps the base map usable after a layer error and retries only the public areas', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const addGeoJson = vi.fn().mockImplementationOnce(() => { throw new Error('sdk error') })
    class Data { setMap() {} addGeoJson = addGeoJson; setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return mapInstance } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(<ConfiguredMapPreview areas={areas} />)
    expect(await screen.findByRole('button', { name: '地図を拡大' })).toBeVisible()
    const retry = await screen.findByRole('button', { name: '地域エリアを再試行' })
    expect(screen.getByRole('alert')).toHaveTextContent('地域エリアを表示できませんでした')
    await user.click(retry)
    await waitFor(() => expect(addGeoJson).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '地図を拡大' })).toBeVisible()
    delete window.google
  })

  it('keeps map controls usable while the area error is shown', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const addGeoJson = vi.fn().mockImplementationOnce(() => { throw new Error('sdk error') })
    const setZoom = vi.fn()
    class Data { setMap() {} addGeoJson = addGeoJson; setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return { ...mapInstance, setZoom } } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(<ConfiguredMapPreview areas={areas} />)
    const retry = await screen.findByRole('button', { name: '地域エリアを再試行' })
    expect(retry.parentElement).toHaveClass('map-area-error')
    await user.click(screen.getByRole('button', { name: '地図を拡大' }))
    expect(setZoom).toHaveBeenCalledWith(6)
    await user.click(retry)
    await waitFor(() => expect(addGeoJson).toHaveBeenCalledTimes(2))
    delete window.google
  })

  it('suppresses swipe-generated area retry clicks while preserving taps and keyboard clicks', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const addGeoJson = vi.fn().mockImplementationOnce(() => { throw new Error('sdk error') }).mockImplementationOnce(() => { throw new Error('sdk error') })
    class Data { setMap() {} addGeoJson = addGeoJson; setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return mapInstance } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    render(<ConfiguredMapPreview areas={areas} />)
    const retry = await screen.findByRole('button', { name: '地域エリアを再試行' })
    await waitFor(() => expect(addGeoJson).toHaveBeenCalledTimes(1))

    fireEvent.pointerDown(retry, { pointerId: 41, pointerType: 'touch', clientX: 20, clientY: 20 })
    fireEvent.pointerMove(retry, { pointerId: 41, pointerType: 'touch', clientX: 22, clientY: 36 })
    fireEvent.pointerUp(retry, { pointerId: 41, pointerType: 'touch', clientX: 22, clientY: 36 })
    fireEvent.click(retry, { detail: 1 })
    expect(addGeoJson).toHaveBeenCalledTimes(1)

    fireEvent.pointerDown(retry, { pointerId: 42, pointerType: 'touch', clientX: 20, clientY: 20 })
    fireEvent.pointerUp(retry, { pointerId: 42, pointerType: 'touch', clientX: 20, clientY: 20 })
    fireEvent.click(retry, { detail: 1 })
    await waitFor(() => expect(addGeoJson).toHaveBeenCalledTimes(2))

    const keyboardRetry = await screen.findByRole('button', { name: '地域エリアを再試行' })
    fireEvent.click(keyboardRetry, { detail: 0 })
    await waitFor(() => expect(addGeoJson).toHaveBeenCalledTimes(3))
    delete window.google
  })

  it('starts at zoom 5 and allows zooming through 12 up to the max of 20, then stops and respects min 5', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    let currentZoom = 5
    let zoomChanged: (() => void) | undefined
    const setZoom = vi.fn((next: number) => { currentZoom = next; zoomChanged?.() })
    const map = { ...mapInstance, getZoom: () => currentZoom, setZoom, addListener: (_name: string, callback: () => void) => { zoomChanged = callback; return { remove() {} } } }
    let mapOptions: Record<string, unknown> | undefined
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor(_element: HTMLElement, options: Record<string, unknown>) { mapOptions = options; return map } }, Data, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { MAP_STYLES } = await import('./mapStyles')
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(<ConfiguredMapPreview />)
    expect(await screen.findByRole('button', { name: '地図を拡大' })).toBeEnabled()
    expect(mapOptions).toMatchObject({ zoom: 5, minZoom: 5, maxZoom: 20 })
    expect(mapOptions?.styles).toEqual(MAP_STYLES)
    // restriction は付けない（D-41 追記）：表示範囲が restriction の幅より広いズームではライブラリが
    // setCenter を restriction 中心へ固定し、fitBounds の中心が差し替わる不具合があったため撤去した。
    expect(mapOptions?.restriction).toBeUndefined()
    // 初期ズーム 5 が最小ズーム 5（D-67）と一致するため、縮小ボタンは初期状態で無効。
    expect(screen.getByRole('button', { name: '地図を縮小' })).toBeDisabled()
    for (let zoom = 6; zoom <= 12; zoom++) await user.click(screen.getByRole('button', { name: '地図を拡大' }))
    expect(currentZoom).toBe(12)
    expect(screen.getByRole('button', { name: '地図を拡大' })).toBeEnabled()
    for (let zoom = 13; zoom <= 20; zoom++) await user.click(screen.getByRole('button', { name: '地図を拡大' }))
    expect(currentZoom).toBe(20)
    expect(screen.getByRole('button', { name: '地図を拡大' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '地図を縮小' }))
    expect(currentZoom).toBe(19)
    for (let zoom = 18; zoom >= 5; zoom--) await user.click(screen.getByRole('button', { name: '地図を縮小' }))
    expect(currentZoom).toBe(5)
    // 最小ズーム 5（D-67）で止まり、縮小ボタンは無効になるためそれ以上は引けない。
    expect(currentZoom).toBe(5)
    expect(screen.getByRole('button', { name: '地図を縮小' })).toBeDisabled()
    expect(setZoom).toHaveBeenLastCalledWith(5)
    delete window.google
  })

  it('suppresses a swipe-generated map-control click while preserving touch taps and keyboard clicks', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const setZoom = vi.fn()
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return { ...mapInstance, getZoom: () => 5, setZoom } } }, Data, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    render(<ConfiguredMapPreview />)
    const zoomIn = await screen.findByRole('button', { name: '地図を拡大' })
    setZoom.mockClear()

    fireEvent.pointerDown(zoomIn, { pointerId: 31, pointerType: 'touch', clientX: 20, clientY: 20 })
    fireEvent.pointerMove(zoomIn, { pointerId: 31, pointerType: 'touch', clientX: 22, clientY: 36 })
    fireEvent.pointerUp(zoomIn, { pointerId: 31, pointerType: 'touch', clientX: 22, clientY: 36 })
    fireEvent.click(zoomIn, { detail: 1 })
    expect(setZoom).not.toHaveBeenCalled()

    fireEvent.pointerDown(zoomIn, { pointerId: 32, pointerType: 'touch', clientX: 20, clientY: 20 })
    fireEvent.pointerUp(zoomIn, { pointerId: 32, pointerType: 'touch', clientX: 20, clientY: 20 })
    fireEvent.click(zoomIn, { detail: 1 })
    expect(setZoom).toHaveBeenCalledTimes(1)
    expect(setZoom).toHaveBeenLastCalledWith(6)

    fireEvent.click(zoomIn, { detail: 0 })
    expect(setZoom).toHaveBeenCalledTimes(2)
    expect(setZoom).toHaveBeenLastCalledWith(6)
    delete window.google
  })

  it('does not draw any veil polygon over the map', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const polygonConstructor = vi.fn()
    class Polygon { constructor(options: Record<string, unknown>) { polygonConstructor(options) } setMap() {} }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    const map = { ...mapInstance }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, Polygon, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { unmount } = render(<ConfiguredMapPreview areas={areas} />)
    expect(await screen.findByRole('button', { name: '地図を拡大' })).toBeVisible()
    // 国外を薄く落とすベールは撤去した（D-41 追記）。地図には一切ポリゴンを重ねない。
    expect(polygonConstructor).not.toHaveBeenCalled()
    unmount()
    delete window.google
  })

  it('fits selected public bounds once, keeps user panning on same selection, and fits initial selection after map readiness', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const fitBounds = vi.fn()
    const setCenter = vi.fn()
    const map = { ...mapInstance, fitBounds, setCenter }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { rerender, unmount } = render(<ConfiguredMapPreview areas={areas} selectedAreaId="area-a" />)
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(1))
    setCenter.mockClear()
    rerender(<ConfiguredMapPreview areas={[...areas]} selectedAreaId="area-a" />)
    expect(fitBounds).toHaveBeenCalledTimes(1)
    expect(setCenter).not.toHaveBeenCalled()
    unmount()
    delete window.google
  })

  it('fits to the selected quest area without an area selection and restores the camera when the quest is deselected (D-65)', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const fitBounds = vi.fn()
    const setCenter = vi.fn()
    const setZoom = vi.fn()
    const map = { ...mapInstance, fitBounds, setCenter, setZoom }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    class Marker { setMap() {} addListener() { return { remove() {} } } }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, Marker, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const quests: PublicQuest[] = [
      { questId: 'q1', version: 1, title: '港の時計台', clue: '大きな時計が見える場所', areaId: 'area-a', visitConditions: '', hintCount: 3 },
    ]
    const { rerender, unmount } = render(<ConfiguredMapPreview areas={areas} quests={quests} onOpenQuest={vi.fn()} />)
    // 初期表示（未選択）は全ピンの範囲へ1回だけ寄せる。
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(1))
    fitBounds.mockClear()
    setCenter.mockClear()
    // 地域を選ばず問題だけを選んでも、所属地域へ寄せる（D-44 の寄せは維持する）。
    rerender(<ConfiguredMapPreview areas={areas} quests={quests} selectedQuestId="q1" onOpenQuest={vi.fn()} />)
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(1))
    // 問題の選択を外すと、選択直前のカメラへ戻る（#43 の復元も維持する）。
    rerender(<ConfiguredMapPreview areas={areas} quests={quests} selectedQuestId="" onOpenQuest={vi.fn()} />)
    await waitFor(() => expect(setCenter).toHaveBeenCalled())
    unmount()
    delete window.google
  })

  it('fits the selected area above the bottom sheet when quests are shown in a sheet', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const fitBounds = vi.fn()
    const map = { ...mapInstance, fitBounds, setCenter: vi.fn() }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { visibleAreaFitPadding } = await import('./fitPadding')
    const quests: PublicQuest[] = [
      { questId: 'q1', version: 1, title: '港の時計台', clue: '大きな時計が見える場所', areaId: 'area-a', visitConditions: '', hintCount: 3 },
    ]
    const { unmount } = render(<ConfiguredMapPreview areas={areas} quests={quests} selectedAreaId="area-a" onOpenQuest={vi.fn()} />)
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(1))
    expect(fitBounds).toHaveBeenCalledWith(expect.anything(), visibleAreaFitPadding(false))
    unmount()
    delete window.google
  })

  it('fits all pin areas once on load with padding for the visible area', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const fitBounds = vi.fn()
    const map = { ...mapInstance, fitBounds, setCenter: vi.fn() }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    class Marker { setMap() {} addListener() { return { remove() {} } } }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, Marker, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { visibleAreaFitPadding } = await import('./fitPadding')
    const { rerender, unmount } = render(<ConfiguredMapPreview areas={areas} />)
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(1))
    expect(fitBounds).toHaveBeenCalledWith(expect.anything(), visibleAreaFitPadding(false))
    rerender(<ConfiguredMapPreview areas={[...areas]} />)
    expect(fitBounds).toHaveBeenCalledTimes(1)
    unmount()
    delete window.google
  })

  it('lets the initial fit own the camera on load without writing the Japan center (D-72)', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const fitBounds = vi.fn()
    const setCenter = vi.fn()
    const setZoom = vi.fn()
    const map = { ...mapInstance, fitBounds, setCenter, setZoom }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    class Marker { setMap() {} addListener() { return { remove() {} } } }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, Marker, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { unmount } = render(<ConfiguredMapPreview areas={areas} />)
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(1))
    // 初期マウントでは選択側の effect が日本中心＋初期ズームを書かない。書くと
    // 初期フィットと競合して初期表示が崩れた（実地報告：朝鮮半島中心に一部のピンだけ）。
    expect(setCenter).not.toHaveBeenCalled()
    expect(setZoom).not.toHaveBeenCalled()
    unmount()
    delete window.google
  })

  it('keeps outside-filter markers dimmed and selectable, with full opacity on hover', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const made: Array<{ title: string; icon: { url: string }; zIndex: number; listeners: Record<string, () => void> }> = []
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    class Marker {
      item: typeof made[number]
      constructor(options: Omit<typeof made[number], 'listeners'>) { this.item = { ...options, listeners: {} }; made.push(this.item) }
      setMap() {}
      setIcon(icon: { url: string }) { this.item.icon = icon }
      addListener(name: string, callback: () => void) { this.item.listeners[name] = callback; return { remove() {} } }
    }
    window.google = { maps: { Map: class { constructor() { return { ...mapInstance, fitBounds() {} } } }, Data, Marker, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const inside: PublicArea = { ...areas[0], areaId: 'hokkaido', label: '北海道の地域', prefectureCode: '01', publicGeometry: { type: 'Polygon', coordinates: [[[141, 43], [142, 43], [142, 44], [141, 44], [141, 43]]] } }
    const outside: PublicArea = { ...areas[0], prefectureCode: '13' }
    const select = vi.fn()
    const { rerender, unmount } = render(<ConfiguredMapPreview areas={[inside, outside]} filterRegion="北海道" onSelectArea={select} />)
    await waitFor(() => expect(made.length).toBeGreaterThanOrEqual(2))
    const outer = made.findLast((marker) => marker.title.startsWith('Aの探索'))!
    const inner = made.findLast((marker) => marker.title.startsWith('北海道の地域'))!
    expect(decodeURIComponent(outer.icon.url)).toContain('opacity="0.3"')
    expect(decodeURIComponent(inner.icon.url)).toContain('opacity="1"')
    expect(inner.zIndex).toBeGreaterThan(outer.zIndex)
    act(() => outer.listeners.mouseover())
    expect(decodeURIComponent(outer.icon.url)).toContain('opacity="1"')
    act(() => outer.listeners.mouseout())
    expect(decodeURIComponent(outer.icon.url)).toContain('opacity="0.3"')
    act(() => outer.listeners.click())
    expect(select).toHaveBeenCalledWith('area-a')
    const neighbor = { ...outside, areaId: 'outside-neighbor' }
    made.length = 0
    rerender(<ConfiguredMapPreview areas={[inside, outside, neighbor]} filterRegion="北海道" onSelectArea={select} />)
    await waitFor(() => expect(made.some((marker) => marker.title.startsWith('重なっている2地域'))).toBe(true))
    const cluster = made.findLast((marker) => marker.title.startsWith('重なっている2地域'))!
    expect(decodeURIComponent(cluster.icon.url)).toContain('opacity="0.3"')
    made.length = 0
    rerender(<ConfiguredMapPreview areas={[inside, outside, { ...neighbor, prefectureCode: '01' }]} filterRegion="北海道" onSelectArea={select} />)
    await waitFor(() => expect(made.some((marker) => marker.title.startsWith('重なっている2地域'))).toBe(true))
    expect(decodeURIComponent(made.findLast((marker) => marker.title.startsWith('重なっている2地域'))!.icon.url)).toContain('opacity="1"')
    unmount()
    delete window.google
  })

  it('refits when the filtered area set changes and returns to all areas when cleared', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const fitBounds = vi.fn()
    const map = { ...mapInstance, fitBounds, setCenter: vi.fn() }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    class Marker { setMap() {} addListener() { return { remove() {} } } }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, Marker, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const areaB: PublicArea = { areaId: 'area-b', label: 'B', publishedCount: 2, marker: { latitude: 43, longitude: 141 },
      publicGeometry: { type: 'Polygon', coordinates: [[[141, 43], [142, 43], [142, 44], [141, 44], [141, 43]]] } }
    const both = [...areas, areaB]
    const { rerender, unmount } = render(<ConfiguredMapPreview areas={both} />)
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(1))
    // ピン集合は全件のまま、場所フィルタの変更で北海道全体へ寄せる（D-60）。
    rerender(<ConfiguredMapPreview areas={both} filterRegion="北海道" filterPrefecture="北海道" />)
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(2))
    // 同じフィルタのままでは寄せ直さない。
    rerender(<ConfiguredMapPreview areas={both} filterRegion="北海道" filterPrefecture="北海道" />)
    expect(fitBounds).toHaveBeenCalledTimes(2)
    // 絞り込みを解除すると全地域の範囲へ戻る。
    rerender(<ConfiguredMapPreview areas={both} />)
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(3))
    unmount()
    delete window.google
  })

  it('fits a single filtered pin to the whole prefecture and caps the zoom instead of diving to street level', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    let zoom = 5
    const idleCallbacks: Array<() => void> = []
    const boundsSeen: Array<{ points: Array<{ lat: number; lng: number }> }> = []
    const setZoom = vi.fn((next: number) => { zoom = next })
    // 実挙動の再現：範囲が実質1点だと fitBounds は最大倍率まで寄る。
    const fitBounds = vi.fn((bounds: { points: Array<{ lat: number; lng: number }> }) => { boundsSeen.push(bounds); zoom = 20 })
    const map = { ...mapInstance, fitBounds, setCenter: vi.fn(), setZoom, getZoom: () => zoom,
      addListener: (name: string, callback: () => void) => { if (name === 'idle') idleCallbacks.push(callback); return { remove() {} } } }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    class Marker { setMap() {} addListener() { return { remove() {} } } }
    class LatLngBounds { points: Array<{ lat: number; lng: number }> = []; extend(point: { lat: number; lng: number }) { this.points.push(point) } }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, Marker, LatLngBounds, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const areaB: PublicArea = { areaId: 'area-b', label: 'B', publishedCount: 2, marker: { latitude: 43, longitude: 141 },
      publicGeometry: { type: 'Polygon', coordinates: [[[141, 43], [142, 43], [142, 44], [141, 44], [141, 43]]] } }
    const both = [...areas, areaB]
    const { rerender, unmount } = render(<ConfiguredMapPreview areas={both} />)
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(1))
    act(() => { idleCallbacks.splice(0).forEach((callback) => callback()) })
    fitBounds.mockClear(); setZoom.mockClear(); boundsSeen.length = 0
    // 北海道のピンが1つでも、範囲は都道府県全体の静的 bbox から作り、
    // 完了後の倍率も上限までに留める（D-60 追記）。
    rerender(<ConfiguredMapPreview areas={both} filterRegion="北海道" filterPrefecture="北海道" />)
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(1))
    expect(boundsSeen[0].points).toHaveLength(4)
    expect(boundsSeen[0].points).toContainEqual({ lat: 41.3, lng: 139.3 })
    expect(boundsSeen[0].points).toContainEqual({ lat: 45.6, lng: 145.9 })
    act(() => { idleCallbacks.splice(0).forEach((callback) => callback()) })
    expect(setZoom).toHaveBeenCalledWith(12)
    expect(zoom).toBe(12)
    unmount()
    delete window.google
  })

  it('records the capped camera after a selection fit that overshoots, so a re-tap at that position deselects', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    let center = { lat: 36.2048, lng: 138.2529 }
    let zoom = 5
    const idleCallbacks: Array<() => void> = []
    const setZoom = vi.fn((next: number) => { zoom = next })
    const fitBounds = vi.fn(() => { center = { lat: 35.5, lng: 139.5 }; zoom = 20 })
    const map = { ...mapInstance, fitBounds, setCenter: vi.fn(), setZoom,
      getCenter: () => ({ lat: () => center.lat, lng: () => center.lng }), getZoom: () => zoom,
      addListener: (name: string, callback: () => void) => { if (name === 'idle') idleCallbacks.push(callback); return { remove() {} } } }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    const instances: Marker[] = []
    class Marker {
      setMap() {}
      click?: () => void
      constructor() { instances.push(this) }
      addListener(name: string, callback: () => void) { if (name === 'click') this.click = callback; return { remove() {} } }
    }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, Marker, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const onSelectArea = vi.fn()
    const { unmount } = render(<ConfiguredMapPreview areas={areas} selectedAreaId="area-a" onSelectArea={onSelectArea} />)
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(instances).toHaveLength(1))
    // 同じ idle リスナーが2回要る：1回目で上限まで引き、2回目で確定位置として記録する。
    const fireIdle = () => act(() => { [...idleCallbacks].forEach((callback) => callback()) })
    fireIdle()
    expect(setZoom).toHaveBeenCalledWith(12)
    fireIdle()
    // カメラが（上限適用後の）フィット位置にあるので、再タップは寄せ直しではなく選択解除になる。
    fitBounds.mockClear()
    act(() => instances[0].click?.())
    expect(onSelectArea).toHaveBeenCalledWith('area-a')
    expect(fitBounds).not.toHaveBeenCalled()
    unmount()
    delete window.google
  })

  it('triggers a map resize once the layout settles in wide mode and fits the selection exactly once', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width'),
      media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(() => false),
    }))
    vi.resetModules()
    const fitBounds = vi.fn()
    const trigger = vi.fn()
    const map = { ...mapInstance, fitBounds, setCenter: vi.fn() }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    class Marker { setMap() {} addListener() { return { remove() {} } } }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, Marker, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }), trigger } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { visibleAreaFitPadding } = await import('./fitPadding')
    const { unmount } = render(<ConfiguredMapPreview areas={areas} selectedAreaId="area-a" />)
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(1))
    // PC幅でサイドバーが開いている間は、フィットにパネル幅ぶんの左パディングを見込む（D-38）。
    expect(fitBounds).toHaveBeenCalledWith(expect.anything(), visibleAreaFitPadding(true))
    expect(trigger).toHaveBeenCalledWith(map, 'resize')
    unmount()
    delete window.google
  })

  it('collapses and reopens the PC sidebar without resizing or refitting the map', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width'),
      media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(() => false),
    }))
    vi.resetModules()
    const trigger = vi.fn()
    const fitBounds = vi.fn()
    const setCenter = vi.fn()
    const map = { ...mapInstance, fitBounds, setCenter }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    class Marker { setMap() {} addListener() { return { remove() {} } } }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, Marker, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }), trigger } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const quests: PublicQuest[] = [
      { questId: 'q1', version: 1, title: '港の時計台', clue: '大きな時計が見える場所', areaId: 'area-a', visitConditions: '', hintCount: 3 },
    ]
    const { container, unmount } = render(<ConfiguredMapPreview areas={areas} quests={quests} onOpenQuest={vi.fn()} />)
    const closeToggle = await screen.findByRole('button', { name: 'サイドバーを閉じる' })
    expect(closeToggle).toHaveAttribute('aria-expanded', 'true')
    expect(container.querySelector('.explore-side-panel')).not.toBeNull()
    expect(document.body).not.toHaveClass('explore-sidebar-collapsed')
    trigger.mockClear()
    fitBounds.mockClear()
    setCenter.mockClear()
    await user.click(closeToggle)
    const openToggle = screen.getByRole('button', { name: 'サイドバーを開く' })
    expect(openToggle).toHaveAttribute('aria-expanded', 'false')
    expect(document.body).toHaveClass('explore-sidebar-collapsed')
    // フローティング方式（D-38）では開閉で地図コンテナが変わらないため、
    // resize も再フィットも中心の移動も起きない。
    expect(trigger).not.toHaveBeenCalled()
    expect(fitBounds).not.toHaveBeenCalled()
    expect(setCenter).not.toHaveBeenCalled()
    await user.click(openToggle)
    expect(screen.getByRole('button', { name: 'サイドバーを閉じる' })).toHaveAttribute('aria-expanded', 'true')
    expect(document.body).not.toHaveClass('explore-sidebar-collapsed')
    expect(trigger).not.toHaveBeenCalled()
    expect(fitBounds).not.toHaveBeenCalled()
    unmount()
    delete window.google
  })

  it('restores the camera from before the selection when the selection is cleared, even across area switches', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    let center = { lat: 36.2048, lng: 138.2529 }
    let zoom = 5
    const setCenter = vi.fn((next: { lat: number; lng: number }) => { center = next })
    const setZoom = vi.fn((next: number) => { zoom = next })
    const fitBounds = vi.fn(() => { center = { lat: 35.5, lng: 139.5 }; zoom = 11 })
    const map = { ...mapInstance, setCenter, setZoom, fitBounds,
      getCenter: () => ({ lat: () => center.lat, lng: () => center.lng }), getZoom: () => zoom }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const areaB: PublicArea = { areaId: 'area-b', label: 'B', publishedCount: 1, marker: { latitude: 34.5, longitude: 135.5 },
      publicGeometry: { type: 'Polygon', coordinates: [[[135, 34], [136, 34], [136, 35], [135, 35], [135, 34]]] } }
    const twoAreas = [...areas, areaB]
    const { rerender, unmount } = render(<ConfiguredMapPreview areas={twoAreas} selectedAreaId="" />)
    // このテストのモックには Marker が無く、初期フィットは走らない。初期マウントで
    // 日本中心＋初期ズームを書く旧挙動（初期フィットとの競合、D-72）も廃止したため、
    // 初期化の目印は置かず、選択後のフィットで待つ（未ready の選択は ready 後に処理される）。
    // 利用者が選択前に地図を動かした状態を再現する。
    setCenter({ lat: 34.6937, lng: 135.5023 })
    setZoom(9)
    setCenter.mockClear(); setZoom.mockClear(); fitBounds.mockClear()
    rerender(<ConfiguredMapPreview areas={twoAreas} selectedAreaId="area-a" />)
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(1))
    rerender(<ConfiguredMapPreview areas={twoAreas} selectedAreaId="area-b" />)
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(2))
    rerender(<ConfiguredMapPreview areas={twoAreas} selectedAreaId="" />)
    // 解除時は初期表示ではなく、最初に選ぶ直前のカメラ（大阪・ズーム9）へ戻る。
    expect(setCenter).toHaveBeenLastCalledWith({ lat: 34.6937, lng: 135.5023 })
    expect(setZoom).toHaveBeenLastCalledWith(9)
    unmount()
    delete window.google
  })

  it('refits instead of deselecting when the selected area pin is tapped after the camera moved, and deselects at the fitted position', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    let center = { lat: 36.2048, lng: 138.2529 }
    let zoom = 5
    const idleCallbacks: Array<() => void> = []
    const fitBounds = vi.fn(() => { center = { lat: 35.5, lng: 139.5 }; zoom = 11 })
    const map = { ...mapInstance, fitBounds, setCenter: vi.fn(), setZoom: vi.fn(),
      getCenter: () => ({ lat: () => center.lat, lng: () => center.lng }), getZoom: () => zoom,
      addListener: (name: string, callback: () => void) => { if (name === 'idle') idleCallbacks.push(callback); return { remove() {} } } }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    const instances: Marker[] = []
    class Marker {
      setMap() {}
      click?: () => void
      constructor() { instances.push(this) }
      addListener(name: string, callback: () => void) { if (name === 'click') this.click = callback; return { remove() {} } }
    }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, Marker, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const onSelectArea = vi.fn()
    const { unmount } = render(<ConfiguredMapPreview areas={areas} selectedAreaId="area-a" onSelectArea={onSelectArea} />)
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(instances).toHaveLength(1))
    // フィット完了（idle）時点のカメラを記録させる。
    act(() => { idleCallbacks.splice(0).forEach((callback) => callback()) })
    // 利用者が地図を動かした状態で、選択中のピンをもう一度押す。
    center = { lat: 34.0, lng: 135.0 }; zoom = 9
    fitBounds.mockClear()
    act(() => instances[0].click?.())
    // 解除はされず、その地域へ寄せ直すだけ（「押したのに移行しない」への対応）。
    expect(onSelectArea).not.toHaveBeenCalled()
    expect(fitBounds).toHaveBeenCalledTimes(1)
    // 再フィットの完了を記録し、カメラがフィット位置にある状態でもう一度押す。
    act(() => { idleCallbacks.splice(0).forEach((callback) => callback()) })
    fitBounds.mockClear()
    act(() => instances[0].click?.())
    // フィット位置にいるので、従来どおり選択解除として呼び出し側へ渡る。
    expect(onSelectArea).toHaveBeenCalledWith('area-a')
    expect(fitBounds).not.toHaveBeenCalled()
    unmount()
    delete window.google
  })

  it('does not record the fit position when a drag interrupts the fit, so a re-tap refits instead of deselecting', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    let center = { lat: 36.2048, lng: 138.2529 }
    let zoom = 5
    const idleCallbacks: Array<() => void> = []
    const dragCallbacks: Array<() => void> = []
    const fitBounds = vi.fn(() => { center = { lat: 35.5, lng: 139.5 }; zoom = 11 })
    const map = { ...mapInstance, fitBounds, setCenter: vi.fn(), setZoom: vi.fn(),
      getCenter: () => ({ lat: () => center.lat, lng: () => center.lng }), getZoom: () => zoom,
      addListener: (name: string, callback: () => void) => {
        if (name === 'idle') idleCallbacks.push(callback)
        if (name === 'dragstart') dragCallbacks.push(callback)
        return { remove() {} }
      } }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    const instances: Marker[] = []
    class Marker {
      setMap() {}
      click?: () => void
      constructor() { instances.push(this) }
      addListener(name: string, callback: () => void) { if (name === 'click') this.click = callback; return { remove() {} } }
    }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, Marker, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const onSelectArea = vi.fn()
    const { unmount } = render(<ConfiguredMapPreview areas={areas} selectedAreaId="area-a" onSelectArea={onSelectArea} />)
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(instances).toHaveLength(1))
    // フィット完了（idle）の前に利用者が地図を掴み、別の場所で止めた状態を再現する（PR #65 指摘のケース）。
    act(() => { dragCallbacks.splice(0).forEach((callback) => callback()) })
    center = { lat: 34.0, lng: 135.0 }; zoom = 9
    // ドラッグ後に静止しても、その位置はフィット完了位置として記録されない。
    act(() => { idleCallbacks.splice(0).forEach((callback) => callback()) })
    fitBounds.mockClear()
    act(() => instances[0].click?.())
    // ドラッグ先にいるカメラを「フィット位置」と誤認せず、解除ではなく寄せ直しに倒れる。
    expect(onSelectArea).not.toHaveBeenCalled()
    expect(fitBounds).toHaveBeenCalledTimes(1)
    unmount()
    delete window.google
  })

  it('selects the area from its pin even when a quest is already selected without an area', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const instances: Marker[] = []
    class Marker {
      setMap() {}
      click?: () => void
      constructor() { instances.push(this) }
      addListener(name: string, callback: () => void) { if (name === 'click') this.click = callback; return { remove() {} } }
    }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    const map = { ...mapInstance, fitBounds: vi.fn() }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, Marker, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const onSelectArea = vi.fn()
    // クエストだけがリンク等で選択済みで、地域は未選択の状態（D-44 の追随前の見え方）。
    const { unmount } = render(<ConfiguredMapPreview areas={areas} selectedAreaId="" selectedQuestId="q1" onSelectArea={onSelectArea} />)
    await waitFor(() => expect(instances).toHaveLength(1))
    act(() => instances[0].click?.())
    expect(onSelectArea).toHaveBeenCalledWith('area-a')
    unmount()
    delete window.google
  })

  it('requests location only on click and zooms to a valid location without changing region selection', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    let success: ((position: { coords: { latitude: number; longitude: number } }) => void) | undefined
    let failure: ((error: { code: number }) => void) | undefined
    const getCurrentPosition = vi.fn((callback: typeof success, onError: typeof failure) => { success = callback; failure = onError })
    const setCenter = vi.fn()
    const setZoom = vi.fn()
    const map = { ...mapInstance, setCenter, setZoom, fitBounds: vi.fn() }
    let mapOptions: Record<string, unknown> | undefined
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    const setMarkerMap = vi.fn()
    const createMarker = vi.fn(function () { return { setMap: setMarkerMap, addListener: () => ({ remove() {} }) } })
    window.google = { maps: { Map: class { constructor(_element: HTMLElement, options: Record<string, unknown>) { mapOptions = options; return map } }, Data, Marker: createMarker, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { geolocation: { getCurrentPosition } }))
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const onSelectArea = vi.fn()
    const { rerender, unmount } = render(<ConfiguredMapPreview areas={areas} selectedAreaId="area-a" onSelectArea={onSelectArea} />)
    expect(await screen.findByRole('button', { name: '現在地へ戻る' })).toBeVisible()
    expect(mapOptions?.zoom).toBe(5)
    expect(getCurrentPosition).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '現在地へ戻る' }))
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), expect.objectContaining({ timeout: 10_000, maximumAge: 0 }))
    const lateSuccess = success
    rerender(<ConfiguredMapPreview areas={areas} selectedAreaId="" onSelectArea={onSelectArea} />)
    expect(document.querySelector('.map-location-status')).not.toBeInTheDocument()
    setCenter.mockClear()
    act(() => lateSuccess?.({ coords: { latitude: 35, longitude: 139 } }))
    expect(setCenter).not.toHaveBeenCalled()
    rerender(<ConfiguredMapPreview areas={areas} selectedAreaId="area-a" onSelectArea={onSelectArea} />)
    await user.click(screen.getByRole('button', { name: '現在地へ戻る' }))
    act(() => failure?.({ code: 1 }))
    expect(document.querySelector('.map-location-status')).toHaveTextContent('位置情報が許可されませんでした')
    expect(document.querySelector('.map-location-status')).toHaveTextContent('アドレスバーのサイト情報から位置情報を「確認」または「許可」に変更')
    // そのセッションで最初の現在地利用なので、結果メッセージに送信案内が一度だけ添えられる（D-28）。
    expect(document.querySelector('.map-location-status')).toHaveTextContent('位置情報はGoogle Mapsに送信されます')
    // 失敗の表示は閉じるボタンでも即座に消せる（D-58）。
    await user.click(screen.getByRole('button', { name: '位置情報の表示を閉じる' }))
    expect(document.querySelector('.map-location-status')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '現在地へ戻る' }))
    expect(getCurrentPosition).toHaveBeenCalledTimes(3)
    act(() => success?.({ coords: { latitude: 35.6812, longitude: 139.7671 } }))
    expect(setCenter).toHaveBeenCalledWith({ lat: 35.6812, lng: 139.7671 })
    expect(setZoom).toHaveBeenCalledWith(14)
    expect(createMarker).toHaveBeenCalledWith(expect.objectContaining({
      position: { lat: 35.6812, lng: 139.7671 }, title: '現在地', clickable: false,
    }))
    expect(document.querySelector('.map-location-status')).toHaveTextContent('現在地を地図の中心に表示しました')
    // 2回目以降の現在地利用では送信案内は繰り返さない。
    expect(document.querySelector('.map-location-status')).not.toHaveTextContent('送信されます')
    expect(onSelectArea).not.toHaveBeenCalled()
    unmount()
    expect(setMarkerMap).toHaveBeenCalledWith(null)
    delete window.google
  })

  it('has no persistent location notice and shows the boundary credit only when requested', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const map = { ...mapInstance, setCenter: vi.fn(), setZoom: vi.fn(), fitBounds: vi.fn() }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, Marker: class { setMap() {} addListener() { return { remove() {} } } }, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { unmount } = render(<ConfiguredMapPreview areas={areas} quests={[]} showBoundaryCredit />)
    expect(await screen.findByRole('region', { name: '選べる謎の一覧' })).toBeVisible()
    // 位置情報の送信案内は地図の右上に常駐しない（D-28）。使う時にだけ結果メッセージへ出す。
    expect(screen.queryByText(/位置情報はGoogle Mapsに送信されます/)).not.toBeInTheDocument()
    expect(document.querySelector('.map-location-action')).not.toBeInTheDocument()
    // 境界データの出典は短い文言でシート内に小さく常駐する（D-46）。
    expect(screen.getByText('境界データ：国土数値情報N03（国土交通省）')).toBeInTheDocument()
    unmount()
    const { unmount: unmountPlain } = render(<ConfiguredMapPreview areas={areas} quests={[]} />)
    expect(await screen.findByRole('region', { name: '選べる謎の一覧' })).toBeVisible()
    expect(screen.queryByText(/国土数値情報/)).not.toBeInTheDocument()
    unmountPlain()
    delete window.google
  })

  it('shows the registered boundary year in the credit when an area carries one', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const map = { ...mapInstance, setCenter: vi.fn(), setZoom: vi.fn(), fitBounds: vi.fn() }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, Marker: class { setMap() {} addListener() { return { remove() {} } } }, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const withYear: PublicArea[] = [{ ...areas[0], boundary: { source: 'N03', year: 2025 } }]
    const { unmount } = render(<ConfiguredMapPreview areas={withYear} quests={[]} showBoundaryCredit />)
    expect(await screen.findByRole('region', { name: '選べる謎の一覧' })).toBeVisible()
    // 登録年度が分かる地域がある場合は、出典に年度まで含める（D-71）。
    expect(screen.getByText('境界データ：国土数値情報N03-2025（国土交通省）')).toBeInTheDocument()
    unmount()
    delete window.google
  })

  it('passes every polygon of a MultiPolygon, including holes and exclaves, to the map layer', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const addGeoJson = vi.fn()
    class Data { setMap() {} addGeoJson = addGeoJson; setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return mapInstance } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const multi: PublicArea = { areaId: 'area-multi', label: 'M', publishedCount: 1, marker: { latitude: 35, longitude: 139 },
      publicGeometry: { type: 'MultiPolygon', coordinates: [
        [[[139, 35], [140, 35], [140, 36], [139, 36], [139, 35]], [[139.2, 35.2], [139.3, 35.2], [139.3, 35.3], [139.2, 35.3], [139.2, 35.2]]],
        [[[141, 37], [142, 37], [142, 38], [141, 38], [141, 37]]],
      ] } }
    const { unmount } = render(<ConfiguredMapPreview areas={[multi]} />)
    expect(await screen.findByRole('button', { name: '地図を拡大' })).toBeVisible()
    await waitFor(() => expect(addGeoJson).toHaveBeenCalledWith(expect.objectContaining({ features: [expect.objectContaining({
      geometry: { type: 'MultiPolygon', coordinates: multi.publicGeometry.coordinates },
    })] })))
    unmount()
    delete window.google
  })

  it('fills only the selected area when fillSelectedAreaOnly is on, and keeps the legacy fill otherwise', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const setStyle = vi.fn()
    class Data { setMap() {} addGeoJson() {} setStyle = setStyle; addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return mapInstance } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    type StyleFn = (feature: { getProperty: (name: string) => unknown }) => Record<string, unknown>
    const feature = (id: string) => ({ getProperty: (_name: string) => id })
    const { rerender, unmount } = render(<ConfiguredMapPreview areas={areas} selectedAreaId="area-a" fillSelectedAreaOnly />)
    expect(await screen.findByRole('button', { name: '地図を拡大' })).toBeVisible()
    await waitFor(() => expect(setStyle).toHaveBeenCalled())
    let styleFn = setStyle.mock.calls.at(-1)?.[0] as unknown as StyleFn
    // 選択中の地域は従来どおり黄色く塗り、未選択の地域は塗りも枠線も出さない（D-29）。
    expect(styleFn(feature('area-a'))).toMatchObject({ fillOpacity: 0.55, strokeOpacity: 0.9 })
    expect(styleFn(feature('area-b'))).toMatchObject({ fillOpacity: 0, strokeOpacity: 0, strokeWeight: 0, clickable: false })
    // モードが無効な既存表示（durable-local 等）では、未選択でも従来の薄い塗りを維持する。
    rerender(<ConfiguredMapPreview areas={areas} selectedAreaId="area-a" />)
    await waitFor(() => expect(setStyle.mock.calls.length).toBeGreaterThan(1))
    styleFn = setStyle.mock.calls.at(-1)?.[0] as unknown as StyleFn
    expect(styleFn(feature('area-b'))).toMatchObject({ fillOpacity: 0.25, clickable: true })
    unmount()
    delete window.google
  })

  it('fits every polygon of a MultiPolygon area, not just the first one', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const extended: Array<{ lat: number; lng: number }> = []
    class RecordingBounds { extend(point: { lat: number; lng: number }) { extended.push(point) } }
    const fitBounds = vi.fn()
    const map = { ...mapInstance, fitBounds }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, Marker: class { setMap() {} addListener() { return { remove() {} } } }, LatLngBounds: RecordingBounds, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    // 東京のデモ地域のように、離れた複数のポリゴンからなる地域。最初のポリゴンは全体の中央付近で、西端・東端は別のポリゴンにある。
    const multi: PublicArea = { areaId: 'area-multi', label: 'M', publishedCount: 1, marker: { latitude: 35.68, longitude: 139.72 },
      publicGeometry: { type: 'MultiPolygon', coordinates: [
        [[[139.70, 35.65], [139.74, 35.65], [139.74, 35.70], [139.70, 35.70], [139.70, 35.65]]],
        [[[139.56, 35.53], [139.60, 35.53], [139.60, 35.58], [139.56, 35.58], [139.56, 35.53]]],
        [[[139.88, 35.78], [139.92, 35.78], [139.92, 35.82], [139.88, 35.82], [139.88, 35.78]]],
      ] } }
    const { unmount } = render(<ConfiguredMapPreview areas={[multi]} selectedAreaId="area-multi" />)
    expect(await screen.findByRole('button', { name: '地図を拡大' })).toBeVisible()
    await waitFor(() => expect(fitBounds).toHaveBeenCalled())
    // フィット範囲は全ポリゴンを走査した全体の広がりになる（最初のポリゴンだけではない）。
    const lngs = extended.map((point) => point.lng)
    const lats = extended.map((point) => point.lat)
    expect(Math.min(...lngs)).toBeCloseTo(139.56)
    expect(Math.max(...lngs)).toBeCloseTo(139.92)
    expect(Math.min(...lats)).toBeCloseTo(35.53)
    expect(Math.max(...lats)).toBeCloseTo(35.82)
    unmount()
    delete window.google
  })

  it('cancels a pending location request when the selected region changes without a usable boundary', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    let success: ((position: { coords: { latitude: number; longitude: number } }) => void) | undefined
    const getCurrentPosition = vi.fn((callback: typeof success) => { success = callback })
    const setCenter = vi.fn()
    const map = { ...mapInstance, setCenter, fitBounds: vi.fn() }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { geolocation: { getCurrentPosition } }))
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const { rerender, unmount } = render(<ConfiguredMapPreview selectedAreaId="area-a" />)
    await user.click(await screen.findByRole('button', { name: '現在地へ戻る' }))
    rerender(<ConfiguredMapPreview selectedAreaId="area-b" />)
    act(() => success?.({ coords: { latitude: 35, longitude: 139 } }))
    expect(setCenter).not.toHaveBeenCalled()
    expect(document.querySelector('.map-location-status')).not.toBeInTheDocument()
    unmount()
    delete window.google
  })

  it('settles without refit requests when the selected area has no area data', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const fitBounds = vi.fn()
    const map = { ...mapInstance, fitBounds }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    // 対象地域のデータが無い選択では、再フィットを要求し続けて描画が終わらなく
    // なることがあった（Issue #129）。地域未指定（既定値）と空配列の明示の両方で、
    // 表示が落ち着いて再描画にも耐えることを固定する。
    const { rerender, unmount } = render(<ConfiguredMapPreview selectedAreaId="area-missing" />)
    expect(await screen.findByRole('button', { name: '現在地へ戻る' })).toBeVisible()
    rerender(<ConfiguredMapPreview areas={[]} selectedAreaId="area-missing" />)
    rerender(<ConfiguredMapPreview areas={[]} selectedAreaId="area-other-missing" />)
    expect(await screen.findByRole('button', { name: '現在地へ戻る' })).toBeVisible()
    expect(fitBounds).not.toHaveBeenCalled()
    unmount()
    delete window.google
  })

  it('ignores a location callback arriving after the ten second deadline', async () => {
    vi.useFakeTimers()
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    let success: ((position: { coords: { latitude: number; longitude: number } }) => void) | undefined
    const getCurrentPosition = vi.fn((callback: typeof success) => { success = callback })
    const setCenter = vi.fn()
    const map = { ...mapInstance, setCenter }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { geolocation: { getCurrentPosition } }))
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    render(<ConfiguredMapPreview />)
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '現在地へ戻る' })).toBeVisible())
    setCenter.mockClear()
    act(() => { screen.getByRole('button', { name: '現在地へ戻る' }).click() })
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(document.querySelector('.map-location-status')).toHaveTextContent('現在地を取得できませんでした')
    act(() => success?.({ coords: { latitude: 35, longitude: 139 } }))
    expect(setCenter).not.toHaveBeenCalled()
    // 失敗の表示も常駐させず、10秒で自動で消える（D-58）。
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(document.querySelector('.map-location-status')).not.toBeInTheDocument()
    delete window.google
    vi.useRealTimers()
  })

  it('keeps the quest list unchanged when the map moves, and follows only the selection-scoped quests', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const listeners = new Map<string, () => void>()
    // 地図の表示範囲がどの地域も含まない場所へ動いても、一覧は表示範囲では変わらない（D-45）。
    const map = { ...mapInstance,
      addListener: (name: string, callback: () => void) => { listeners.set(name, callback); return { remove: () => { listeners.delete(name) } } },
      getBounds: () => ({
        getNorthEast: () => ({ lat: () => 32, lng: () => 132 }),
        getSouthWest: () => ({ lat: () => 30, lng: () => 129 }),
      }),
    }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const quests: PublicQuest[] = [
      { questId: 'q1', version: 1, title: '港の時計台', clue: '大きな時計が見える場所', areaId: 'area-a', visitConditions: '', hintCount: 3 },
      { questId: 'q2', version: 1, title: '博多の灯台', clue: '海に突き出た灯台', areaId: 'area-b', visitConditions: '', hintCount: 2 },
    ]
    const { rerender, unmount } = render(<ConfiguredMapPreview areas={areas} quests={quests} onOpenQuest={vi.fn()} />)
    // 地図が使えるようになるとリストはボトムシートへ移るため、移行後の要素で確認する。
    await waitFor(() => expect(screen.getByRole('button', { name: '港の時計台の詳細を見る' })).toBeVisible())
    act(() => listeners.get('idle')?.())
    // 表示範囲の外にある地域の問題も、一覧からは消えない。空表示にもならない。
    expect(screen.getByRole('button', { name: '港の時計台の詳細を見る' })).toBeVisible()
    expect(screen.getByRole('button', { name: '博多の灯台の詳細を見る' })).toBeVisible()
    expect(screen.getByText('2件')).toBeVisible()
    expect(screen.queryByText(/この範囲に謎はありません/)).not.toBeInTheDocument()
    // 選択で絞られた問題が渡されれば、一覧はその分だけに切り替わる（選択連動）。
    rerender(<ConfiguredMapPreview areas={areas} quests={[quests[0]]} onOpenQuest={vi.fn()} />)
    expect(screen.getByRole('button', { name: '港の時計台の詳細を見る' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '博多の灯台の詳細を見る' })).not.toBeInTheDocument()
    expect(screen.getByText('1件')).toBeVisible()
    unmount()
    delete window.google
  })

  it('places one pin per area at the public geometry centroid and highlights its quests in the linked list on tap', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const instances: Marker[] = []
    class Marker {
      options: Record<string, unknown>
      setMap = vi.fn()
      removeListener = vi.fn()
      click?: () => void
      constructor(options: Record<string, unknown>) { this.options = options; instances.push(this) }
      addListener(_name: string, callback: () => void) { this.click = callback; return { remove: this.removeListener } }
    }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return mapInstance } }, Data, Marker, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const quests: PublicQuest[] = [
      { questId: 'q1', version: 1, title: '港の時計台', clue: '大きな時計が見える場所', areaId: 'area-a', visitConditions: '', hintCount: 3 },
      { questId: 'q2', version: 1, title: '石畳の坂', clue: '坂の途中にある石碑', areaId: 'area-a', visitConditions: '', hintCount: 3 },
    ]
    const onSelectArea = vi.fn()
    const onOpenQuest = vi.fn()
    const pinAreas: PublicArea[] = [{ ...areas[0], publishedCount: 2 }]
    const { container, rerender, unmount } = render(<ConfiguredMapPreview areas={pinAreas} quests={quests} onSelectArea={onSelectArea} onOpenQuest={onOpenQuest} />)
    await waitFor(() => expect(instances).toHaveLength(1))
    // 外周リング (139,35)-(140,36) の重心。問題の対象座標は使わない。
    expect(instances[0].options.position).toEqual({ lat: 35.5, lng: 139.5 })
    expect(instances[0].options.title).toBe('Aの探索エリア（2問）')
    const iconUrl = decodeURIComponent((instances[0].options.icon as { url: string }).url)
    expect(iconUrl).toContain('#4eb8d0')
    expect(iconUrl).toContain('>2<')
    // 連動リストには地図下に問題カードが並ぶ（代表点の注記は置かない、D-39）。
    expect(await screen.findByRole('region', { name: '選べる謎の一覧' })).toBeVisible()
    expect(screen.getByRole('button', { name: '港の時計台の詳細を見る' })).toBeVisible()
    expect(screen.getByRole('button', { name: '石畳の坂の詳細を見る' })).toBeVisible()
    expect(screen.queryByText('ピンは地域の代表点です。問題の場所そのものではありません。')).not.toBeInTheDocument()
    // 地図が使える時は連動リストはボトムシートに入り、初期状態は覗き見（peek）。
    const sheet = container.querySelector('.explore-sheet')
    expect(sheet).not.toBeNull()
    expect(sheet).toHaveAttribute('data-snap', 'peek')
    expect(container.querySelector('.map-preview-shell')).toHaveClass('has-sheet')
    act(() => instances[0].click?.())
    expect(onSelectArea).toHaveBeenCalledWith('area-a')
    // ピンを選ぶと、ハイライトされたカードが見える位置までシートが開く。
    expect(sheet).toHaveAttribute('data-snap', 'half')
    expect(screen.getByRole('button', { name: '港の時計台の詳細を見る' }).closest('li')).toHaveClass('is-highlighted')
    expect(screen.getByRole('button', { name: '石畳の坂の詳細を見る' }).closest('li')).toHaveClass('is-highlighted')
    // 選択中地域のサマリバー（黄色いバー）は出さない（D-45）。閉じる導線はピンの再タップに寄せる。
    expect(container.querySelector('.explore-list-focus')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '閉じる' })).not.toBeInTheDocument()
    // ピンをもう一度押すとハイライトが外れる。
    act(() => instances[0].click?.())
    expect(screen.getByRole('button', { name: '港の時計台の詳細を見る' }).closest('li')).not.toHaveClass('is-highlighted')
    expect(screen.getByRole('button', { name: '港の時計台の詳細を見る' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '港の時計台の詳細を見る' }))
    expect(onOpenQuest).toHaveBeenCalledWith('q1')
    rerender(<ConfiguredMapPreview areas={[{ ...areas[0], publishedCount: 0 }]} quests={quests} onSelectArea={onSelectArea} onOpenQuest={onOpenQuest} />)
    await waitFor(() => expect(instances[0].setMap).toHaveBeenCalledWith(null))
    expect(instances[0].removeListener).toHaveBeenCalled()
    unmount()
    delete window.google
  })

  it('uses the active red for the selected area pin and passes themed styles to the map', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const instances: Marker[] = []
    class Marker {
      options: Record<string, unknown>
      setMap = vi.fn()
      click?: () => void
      constructor(options: Record<string, unknown>) { this.options = options; instances.push(this) }
      addListener(_name: string, callback: () => void) { this.click = callback; return { remove() {} } }
    }
    let mapOptions: Record<string, unknown> | undefined
    const map = { ...mapInstance, fitBounds: vi.fn() }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor(_element: HTMLElement, options: Record<string, unknown>) { mapOptions = options; return map } }, Data, Marker, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const quests: PublicQuest[] = [
      { questId: 'q1', version: 1, title: '港の時計台', clue: '大きな時計が見える場所', areaId: 'area-a', visitConditions: '', hintCount: 3 },
    ]
    const { unmount } = render(<ConfiguredMapPreview areas={areas} quests={quests} selectedAreaId="area-a" />)
    await waitFor(() => expect(instances).toHaveLength(1))
    const iconUrl = decodeURIComponent((instances[0].options.icon as { url: string }).url)
    // 選択中のピンもホバーと同じ赤。ピン本体に黄色（#f6d84a）は使わない（黄色は地域の塗りだけ）。
    expect(iconUrl).toContain('fill="#e7473f"')
    expect(iconUrl).not.toContain('#f6d84a')
    expect(iconUrl).not.toContain('>1<')
    expect(mapOptions?.styles).toEqual(expect.arrayContaining([
      expect.objectContaining({ featureType: 'water', elementType: 'geometry' }),
      expect.objectContaining({ featureType: 'road.highway' }),
    ]))
    unmount()
    delete window.google
  })

  it('marks the page as full-bleed while the sheet is shown and clears the mark on unmount', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return mapInstance } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const quests: PublicQuest[] = [
      { questId: 'q1', version: 1, title: '港の時計台', clue: '大きな時計が見える場所', areaId: 'area-a', visitConditions: '', hintCount: 3 },
    ]
    const { unmount } = render(<ConfiguredMapPreview areas={areas} quests={quests} onOpenQuest={vi.fn()} />)
    // 一覧は地図の読み込み完了でシート内へ移るため、ready を待ってからシート内の一覧を見る。
    await screen.findByRole('button', { name: '地図を拡大' })
    expect(screen.getByRole('region', { name: '選べる謎の一覧' })).toBeVisible()
    // シート表示の目印（body のクラス）は effect で付くため、付くまで待つ。
    await waitFor(() => expect(document.body).toHaveClass('explore-fullbleed'))
    unmount()
    expect(document.body).not.toHaveClass('explore-fullbleed')
    delete window.google
  })

  it('notifies the sheet mode for selection display switching and resets it on unmount', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return mapInstance } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const onSheetModeChange = vi.fn()
    const quests: PublicQuest[] = [
      { questId: 'q1', version: 1, title: '港の時計台', clue: '大きな時計が見える場所', areaId: 'area-a', visitConditions: '', hintCount: 3 },
    ]
    const { unmount } = render(<ConfiguredMapPreview areas={areas} quests={quests} onOpenQuest={vi.fn()} onSheetModeChange={onSheetModeChange} />)
    await screen.findByRole('button', { name: '地図を拡大' })
    expect(screen.getByRole('region', { name: '選べる謎の一覧' })).toBeVisible()
    // 地図が使える間はシート表示であることを知らせ、呼び出し側がピッカーを隠せるようにする（D-43）。
    await waitFor(() => expect(onSheetModeChange).toHaveBeenCalledWith(true))
    unmount()
    // アンマウント時は「使えない」側へ戻し、地図が無い画面でピッカーが消えたままにならないようにする。
    expect(onSheetModeChange).toHaveBeenLastCalledWith(false)
    delete window.google
  })

  it('reports no sheet mode when the map is unavailable', () => {
    const onSheetModeChange = vi.fn()
    const quests: PublicQuest[] = [
      { questId: 'q1', version: 1, title: '港の時計台', clue: '大きな時計が見える場所', areaId: 'area-a', visitConditions: '', hintCount: 3 },
    ]
    render(<MapPreview areas={areas} quests={quests} onOpenQuest={vi.fn()} onSheetModeChange={onSheetModeChange} />)
    expect(onSheetModeChange).toHaveBeenCalledWith(false)
    expect(onSheetModeChange).not.toHaveBeenCalledWith(true)
  })

  it('keeps the sheet and full-bleed layout with a filter-empty message when filtering leaves no quests', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return mapInstance } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const quests: PublicQuest[] = [
      { questId: 'q1', version: 1, title: '港の時計台', clue: '大きな時計が見える場所', areaId: 'area-a', visitConditions: '', hintCount: 3 },
    ]
    const { container, rerender, unmount } = render(<ConfiguredMapPreview areas={areas} quests={quests} onOpenQuest={vi.fn()} />)
    await screen.findByRole('button', { name: '地図を拡大' })
    expect(screen.getByRole('region', { name: '選べる謎の一覧' })).toBeVisible()
    expect(container.querySelector('.explore-sheet')).not.toBeNull()
    expect(document.body).toHaveClass('explore-fullbleed')
    rerender(<ConfiguredMapPreview areas={areas} quests={[]} onOpenQuest={vi.fn()} />)
    expect(container.querySelector('.explore-sheet')).not.toBeNull()
    expect(container.querySelector('.map-preview-shell')).toHaveClass('has-sheet')
    expect(document.body).toHaveClass('explore-fullbleed')
    expect(screen.getByText('0件')).toBeVisible()
    expect(screen.getByText('選択中の条件に合う謎はありません。地方・都道府県の条件を変えると、別の謎が表示されます。')).toBeVisible()
    unmount()
    expect(document.body).not.toHaveClass('explore-fullbleed')
    delete window.google
  })

  it('does not mark the page as full-bleed when the map is unavailable', () => {
    const quests: PublicQuest[] = [
      { questId: 'q1', version: 1, title: '港の時計台', clue: '大きな時計が見える場所', areaId: 'area-a', visitConditions: '', hintCount: 3 },
    ]
    render(<MapPreview areas={areas} quests={quests} onOpenQuest={vi.fn()} />)
    expect(screen.getByRole('region', { name: '選べる謎の一覧' })).toBeVisible()
    expect(document.body).not.toHaveClass('explore-fullbleed')
  })

  it('shows the selected area as a small chip on the map and hides it without a selection', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const map = { ...mapInstance, fitBounds: vi.fn() }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const quests: PublicQuest[] = [
      { questId: 'q1', version: 1, title: '港の時計台', clue: '大きな時計が見える場所', areaId: 'area-a', visitConditions: '', hintCount: 3 },
    ]
    const { container, rerender, unmount } = render(<ConfiguredMapPreview areas={areas} quests={quests} selectedAreaId="area-a" onSelectArea={vi.fn()} onOpenQuest={vi.fn()} />)
    await screen.findByRole('button', { name: '地図を拡大' })
    expect(screen.getByRole('region', { name: '選べる謎の一覧' })).toBeVisible()
    // スコープ表示「全国の謎」は置かず、選択中地域のチップだけを出す。
    expect(container.querySelector('.map-scope')).not.toBeInTheDocument()
    expect(screen.queryByText('全国の謎')).not.toBeInTheDocument()
    const chip = container.querySelector('.map-area-chip')
    expect(chip).not.toBeNull()
    expect(chip).toHaveTextContent('A')
    rerender(<ConfiguredMapPreview areas={areas} quests={quests} selectedAreaId="" onSelectArea={vi.fn()} onOpenQuest={vi.fn()} />)
    expect(container.querySelector('.map-area-chip')).not.toBeInTheDocument()
    unmount()
    delete window.google
  })

  it('raises the sheet to half while a quest is selected and opens a tapped card without dragging', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const map = { ...mapInstance, fitBounds: vi.fn() }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    class Marker { setMap() {} addListener() { return { remove() {} } } }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, Marker, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { SHEET_PEEK_HEIGHT } = await import('./ExploreBottomSheet')
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const onOpenQuest = vi.fn()
    const quests: PublicQuest[] = [
      { questId: 'q1', version: 1, title: '港の時計台', clue: '大きな時計が見える場所', areaId: 'area-a', visitConditions: '', hintCount: 3 },
    ]
    const questScrollTarget = { current: null as HTMLDivElement | null }
    const detailFor = (title: string) => <div><header className="quest-card-heading"><h3>{title}</h3></header></div>
    const quests2: PublicQuest[] = [
      ...quests,
      { questId: 'q2', version: 1, title: '博多の灯台', clue: '海に突き出た灯台', areaId: 'area-a', visitConditions: '', hintCount: 2 },
    ]
    const { container, rerender, unmount } = render(<ConfiguredMapPreview areas={areas} quests={quests2} selectedQuestId="q2" onOpenQuest={onOpenQuest} questScrollTarget={questScrollTarget} questDetail={detailFor('博多の灯台')} />)
    const sheet = await waitFor(() => {
      const element = container.querySelector('.explore-sheet')
      expect(element).not.toBeNull()
      return element as HTMLElement
    })
    // 問題が選択されている間は、詳細が覗き見（peek）の枠内に埋もれないよう、シートは
    // half まで開いた状態で出る（D-70）。ステージ高さは jsdom では代替値 640 になり、
    // half はその 55%（352px）。開くのは effect 経由なので状態が落ち着くまで待つ。
    await waitFor(() => expect(sheet).toHaveAttribute('data-snap', 'half'))
    expect(sheet.style.height).toBe('352px')
    expect(SHEET_PEEK_HEIGHT).toBe(168)
    expect(screen.queryByRole('button', { name: '問題を見る' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '港の時計台の詳細を見る' }))
    expect(onOpenQuest).toHaveBeenCalledWith('q1')
    // 呼び出し側が選択を切り替えると、詳細は新しい選択行の直下へ移る。
    rerender(<ConfiguredMapPreview areas={areas} quests={quests2} selectedQuestId="q1" onOpenQuest={onOpenQuest} questScrollTarget={questScrollTarget} questDetail={detailFor('港の時計台')} />)
    const mapShell = container.querySelector('.map-preview-shell') as HTMLElement
    vi.spyOn(mapShell, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width: 400, height: 0 }))
    fireEvent.scroll(window)
    const scroll = vi.fn()
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scroll
    // シートが伸びても「地図に戻る」は固定位置で前面に残る（シートは選択に合わせて
    // 既に half まで開いているため、ここではハンドル操作は挟まない）。
    const browseShortcut = container.querySelector('.map-browse-shortcut') as HTMLButtonElement
    expect(browseShortcut).toHaveClass('is-return-to-map')
    expect(browseShortcut).not.toHaveAttribute('inert')
    expect(browseShortcut).toBeEnabled()
    expect(screen.getByRole('button', { name: '地図に戻る' })).toBe(browseShortcut)
    const title = screen.getByRole('heading', { name: '港の時計台' })
    expect(sheet).toContainElement(title)
    await user.click(browseShortcut)
    expect(scroll).toHaveBeenCalledWith({ block: 'start' })
    expect(container.querySelector('.explore-sheet')).toBe(sheet)
    expect(sheet).toHaveAttribute('data-snap', 'half')
    // Once the sheet is closed, 問題を見る navigates to the below-map list.
    const handle = screen.getByRole('button', { name: '謎リストを縮める' })
    fireEvent.pointerDown(handle, { pointerId: 30, pointerType: 'touch', clientY: 200 })
    fireEvent.pointerMove(handle, { pointerId: 30, pointerType: 'touch', clientY: 600 })
    fireEvent.pointerUp(handle, { pointerId: 30, pointerType: 'touch', clientY: 600 })
    expect(sheet).toHaveAttribute('data-snap', 'closed')
    const reopen = screen.getByRole('button', { name: '問題を見る' })
    expect(reopen).not.toHaveAttribute('aria-expanded')
    expect(reopen).not.toHaveAttribute('aria-controls')
    await user.click(reopen)
    expect(sheet).toHaveAttribute('data-snap', 'closed')
    expect(container.querySelector('.below-map-quests')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '謎リストを広げる' }))
    expect(sheet).toHaveAttribute('data-snap', 'peek')
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    unmount()
    delete window.google
  })

  it('keeps every quest in the sheet list when one is selected and routes a re-tap of the selected row to deselect (D-65)', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const map = { ...mapInstance, fitBounds: vi.fn() }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    class Marker { setMap() {} addListener() { return { remove() {} } } }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, Marker, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const onOpenQuest = vi.fn()
    const onDeselectQuest = vi.fn()
    const quests: PublicQuest[] = [
      { questId: 'q1', version: 1, title: '港の時計台', clue: '大きな時計が見える場所', areaId: 'area-a', visitConditions: '', hintCount: 3 },
      { questId: 'q2', version: 1, title: '博多の灯台', clue: '海に突き出た灯台', areaId: 'area-b', visitConditions: '', hintCount: 2 },
    ]
    const detail = <div><h3>博多の灯台の詳細</h3></div>
    const { container, unmount } = render(<ConfiguredMapPreview areas={areas} quests={quests} selectedQuestId="q2"
      onOpenQuest={onOpenQuest} onDeselectQuest={onDeselectQuest} questDetail={detail} />)
    await waitFor(() => expect(container.querySelector('.explore-sheet')).not.toBeNull())
    // スマホのシートでも PC と同じモデル：選択中の問題の所属地域で一覧は絞られず、
    // 他の地域の問題も残り、詳細は選択中の行の直下にだけ開く。
    const selectedRow = screen.getByRole('button', { name: '博多の灯台の詳細を見る' })
    expect(selectedRow).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '港の時計台の詳細を見る' })).toBeVisible()
    expect(selectedRow.closest('li')).toContainElement(screen.getByRole('heading', { name: '博多の灯台の詳細' }))
    // 選択中の行の再タップは選択解除へ、別の行は選択として伝える。
    await user.click(selectedRow)
    expect(onDeselectQuest).toHaveBeenCalledTimes(1)
    expect(onOpenQuest).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '港の時計台の詳細を見る' }))
    expect(onOpenQuest).toHaveBeenCalledWith('q1')
    unmount()
    delete window.google
  })

  it('uses the same red hover highlight when a touch-first pointer reports hover', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(() => false),
    }))
    vi.resetModules()
    const map = { ...mapInstance, setZoom: vi.fn(), fitBounds: vi.fn() }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    const markers: Array<{ options: Record<string, unknown>; listeners: Map<string, () => void>; icons: Array<{ url: string }> }> = []
    class Marker {
      options: Record<string, unknown>
      listeners = new Map<string, () => void>()
      icons: Array<{ url: string }> = []
      constructor(options: Record<string, unknown>) { this.options = options; markers.push(this) }
      setMap() {}
      addListener(name: string, callback: () => void) { this.listeners.set(name, callback); return { remove: () => {} } }
      setIcon(icon: { url: string }) { this.icons.push(icon) }
    }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, Marker, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { unmount, container } = render(<ConfiguredMapPreview areas={areas} quests={[]} onSelectArea={vi.fn()} onOpenQuest={vi.fn()} />)
    await screen.findByRole('region', { name: '選べる謎の一覧' })
    const controls = container.querySelector('.map-controls')
    expect(controls?.parentElement).toBe(container.querySelector('.map-preview-shell'))
    expect(controls?.parentElement).not.toBe(container.querySelector('.map-preview'))
    const { userEvent } = await import('@testing-library/user-event')
    await userEvent.setup().click(screen.getByRole('button', { name: '地図を拡大' }))
    expect(map.setZoom).toHaveBeenCalledWith(6)
    expect(markers.length).toBeGreaterThan(0)
    const marker = markers[0]
    expect(marker.options.cursor).toBe('pointer')
    expect(marker.listeners.has('mouseover')).toBe(true)
    marker.listeners.get('mouseover')?.()
    const hoverIcon = decodeURIComponent(marker.icons.at(-1)?.url ?? '')
    expect(hoverIcon).toContain('width="42"')
    expect(hoverIcon).toContain('fill="#e7473f" stroke=')
    marker.listeners.get('mouseout')?.()
    const baseIcon = decodeURIComponent(marker.icons.at(-1)?.url ?? '')
    expect(baseIcon).toContain('width="36"')
    expect(baseIcon).toContain('fill="#4eb8d0" stroke=')
    unmount()
    delete window.google
    vi.unstubAllGlobals()
  })

  it('clusters overlapping pins into one marker with the total quest count and fits to them on tap (D-52)', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const fitBounds = vi.fn()
    const map = { ...mapInstance, setZoom: vi.fn(), fitBounds, getCenter: () => ({ lat: () => 36.2, lng: () => 138.25 }) }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    const markers: Array<{ options: Record<string, unknown>; listeners: Map<string, () => void> }> = []
    class Marker {
      options: Record<string, unknown>
      listeners = new Map<string, () => void>()
      constructor(options: Record<string, unknown>) { this.options = options; markers.push(this) }
      setMap() {}
      addListener(name: string, callback: () => void) { this.listeners.set(name, callback); return { remove: () => {} } }
      setIcon() {}
    }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, Marker, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const square = (lat: number, lng: number): PublicArea['publicGeometry'] => ({ type: 'Polygon', coordinates: [[[lng - 0.1, lat - 0.1], [lng + 0.1, lat - 0.1], [lng + 0.1, lat + 0.1], [lng - 0.1, lat + 0.1], [lng - 0.1, lat - 0.1]]] })
    const clusterAreas: PublicArea[] = [
      { areaId: 'close-a', label: '近い地域A', publishedCount: 2, marker: { latitude: 35, longitude: 139 }, publicGeometry: square(35, 139) },
      { areaId: 'close-b', label: '近い地域B', publishedCount: 3, marker: { latitude: 35.1, longitude: 139.1 }, publicGeometry: square(35.1, 139.1) },
      { areaId: 'far', label: '遠い地域', publishedCount: 1, marker: { latitude: 43, longitude: 141.3 }, publicGeometry: square(43, 141.3) },
    ]
    const { rerender, unmount } = render(<ConfiguredMapPreview areas={clusterAreas} quests={[]} onSelectArea={vi.fn()} />)
    await screen.findByRole('region', { name: '選べる謎の一覧' })
    // 近い2地域は1つのクラスタ（合計5問）にまとまり、遠い地域は単独ピンになる。
    await waitFor(() => expect(markers.length).toBe(2))
    const cluster = markers.find((marker) => String(marker.options.title).includes('合計5問'))
    expect(cluster).toBeDefined()
    expect(decodeURIComponent(String((cluster!.options.icon as { url: string }).url))).toContain('>5<')
    fitBounds.mockClear()
    cluster!.listeners.get('click')?.()
    expect(fitBounds).toHaveBeenCalled()
    // 選択中の地域のピンはクラスタに隠さない（D-52）。
    markers.length = 0
    rerender(<ConfiguredMapPreview areas={clusterAreas} quests={[]} selectedAreaId="close-a" onSelectArea={vi.fn()} />)
    await waitFor(() => expect(markers.length).toBe(3))
    expect(markers.some((marker) => String(marker.options.title).includes('合計'))).toBe(false)
    unmount()
    delete window.google
  })
})

const mapInstance = { setZoom() {}, getZoom: () => 5, setCenter() {}, addListener: () => ({ remove() {} }) }
