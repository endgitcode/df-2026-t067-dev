//?debug=1 のときだけ有効になるカメラ操作の記録。
// 「ピンを押しても選んだ地域へ地図が移行しない」不具合（2026-11-08、実機＋ブラウザで再現）を
// 実行時の証拠で特定するためのもので、原因が確定したら丸ごと取り除く。
//?debug=1 でない限り、記録・ラップ・画面表示のすべてが無効で、通常の挙動と見た目に影響しない。
import type { MapInstance} from './googleMapsLoader'

export interface CameraLogEntry {
/** ISO 8601 の時刻。 */
t: string
/** fitBounds / setCenter / setZoom / areaFitPoints / areasLoaded / instrumented など。 */
kind: string
/** 呼び出し元のラベル（選択フィット／初期フィット／復元／レイアウト確定の再フィット／現在地／リセット等）。
ラベルが付いていない呼び出しではスタックトレースの要約が入る。 */
label: string
detail?: unknown
}

interface CameraLogWindow {
__cameraLog?: CameraLogEntry[]
}

export const CAMERA_DEBUG_ENABLED: boolean = (() => {
try {
return typeof window!== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1'
} catch {
return false
}
})()

function getLog(): CameraLogEntry[] {
const target = window as unknown as CameraLogWindow
if (!target.__cameraLog) target.__cameraLog = []
return target.__cameraLog
}

function safeStringify(entry: CameraLogEntry): string {
try {
return JSON.stringify(entry)
} catch {
return '{"t":"?","kind":"unserializable"}'
}
}

/** 記録の末尾50件を画面上の <pre id="camera-debug"> へ書き出す（検証側が DOM から読むため）。 */
export function flushCameraDebug(): void {
if (!CAMERA_DEBUG_ENABLED || typeof document === 'undefined') return
const element = document.getElementById('camera-debug')
if (!element) return
element.textContent = getLog().slice(-50).map(safeStringify).join('\n')
}

let currentLabel: string | null = null

function stackSummary(): string {
const lines = (new Error().stack?? '').split('\n').map((line) => line.trim()).filter(Boolean)
// 先頭の "Error" と、この関数と cameraLog 自身のフレームを除いた呼び出し側を最大3つ拾う。
return lines.slice(3, 6).join(' <- ')
}

/** 既知の呼び出し箇所からカメラ操作にラベルを付けるためのスコープ。無効時は素通し。 */
export function withCameraLabel<T>(label: string, run: () => T): T {
if (!CAMERA_DEBUG_ENABLED) return run()
const previous = currentLabel
currentLabel = label
try {
return run()
} finally {
currentLabel = previous
}
}

/** 計測イベントを1件記録する。無効時は何もしない。 */
export function cameraLog(kind: string, detail?: unknown): void {
if (!CAMERA_DEBUG_ENABLED) return
const entry: CameraLogEntry = { t: new Date().toISOString(), kind, label: currentLabel?? stackSummary()}
if (detail!== undefined) entry.detail = detail
getLog().push(entry)
flushCameraDebug()
}

function readLatLng(value: unknown): { lat: number; lng: number} | string {
try {
if (value && typeof value === 'object') {
const candidate = value as { lat?: unknown; lng?: unknown}
if (typeof candidate.lat === 'function' && typeof candidate.lng === 'function') {
const lat = (candidate.lat as () => number).call(value)
const lng = (candidate.lng as () => number).call(value)
return { lat, lng}
}
if (typeof candidate.lat === 'number' && typeof candidate.lng === 'number') {
return { lat: candidate.lat, lng: candidate.lng}
}
}
} catch { /* 読めない値はそのまま文字列で残す。 */}
return String(value)
}

function summarizeBounds(value: unknown): unknown {
try {
if (value && typeof value === 'object') {
const candidate = value as { getNorthEast?: unknown; getSouthWest?: unknown}
if (typeof candidate.getNorthEast === 'function' && typeof candidate.getSouthWest === 'function') {
return {
ne: readLatLng((candidate.getNorthEast as () => unknown).call(value)),
sw: readLatLng((candidate.getSouthWest as () => unknown).call(value)),
}
}
}
} catch { /* 読めない場合はその旨を残す。 */}
return 'unreadable-bounds'
}

const instrumentedInstances = new WeakSet<object>()

/**
* 地図インスタンスのカメラ操作（fitBounds / setCenter / setZoom）をすべて記録するようラップする。
* 生成直後に1回だけ呼ぶ。無効時・二重呼び出しでは何もしない。
*/
export function instrumentMapInstance(instance: MapInstance): void {
if (!CAMERA_DEBUG_ENABLED || instrumentedInstances.has(instance)) return
instrumentedInstances.add(instance)
const target = instance as unknown as Record<string, unknown>
const wrap = (method: 'fitBounds' | 'setCenter' | 'setZoom', summarize: (args: unknown[]) => unknown) => {
const original = target[method]
if (typeof original!== 'function') return
target[method] = function (this: unknown,...args: unknown[]) {
cameraLog(method, summarize(args))
return (original as (this: unknown,...rest: unknown[]) => unknown).apply(this, args)
}
}
wrap('fitBounds', (args) => ({ bounds: summarizeBounds(args[0]), padding: args[1]?? null}))
wrap('setCenter', (args) => ({ center: readLatLng(args[0])}))
wrap('setZoom', (args) => ({ zoom: args[0]}))
cameraLog('instrumented', { methods: ['fitBounds', 'setCenter', 'setZoom']})
}

/** 点群の範囲（北東・南西）を返す。空なら null。 */
export function pointsRange(points: Array<{ lat: number; lng: number}>): { ne: { lat: number; lng: number}; sw: { lat: number; lng: number}} | null {
if (!points.length) return null
let north = -Infinity
let south = Infinity
let east = -Infinity
let west = Infinity
for (const point of points) {
north = Math.max(north, point.lat)
south = Math.min(south, point.lat)
east = Math.max(east, point.lng)
west = Math.min(west, point.lng)
}
return { ne: { lat: north, lng: east}, sw: { lat: south, lng: west}}
}
