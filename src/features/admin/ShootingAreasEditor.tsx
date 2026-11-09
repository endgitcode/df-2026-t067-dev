import { useCallback, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, CAPTURE_ZONE_RADIUS_METERS, parseCaptureZones, parseUpdateShootingAreas } from '../../shared/api'
import type { ApiClient, CaptureZone, ManagedShootingAreas } from '../../shared/api'
import { useRemote } from '../../shared/useRemote'
import { useRequestAction } from '../../shared/useRequestAction'
import { ShootingAreasMap } from './ShootingAreasMap'

type ZoneInput = Record<keyof CaptureZone, string>
type State = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'
const fields = [['latitude', '緯度'], ['longitude', '経度']] as const

function toInputs(zones: CaptureZone[]): ZoneInput[] {
  return zones.map(({ latitude, longitude, radiusMeters }) => ({
    latitude: String(latitude), longitude: String(longitude), radiusMeters: String(radiusMeters),
  }))
}

function areaInput(rows: ZoneInput[], revision: number) {
  if (rows.some((row) => fields.some(([field]) => !row[field].trim()) || Number(row.radiusMeters) !== CAPTURE_ZONE_RADIUS_METERS)) return null
  try {
    return parseUpdateShootingAreas({ expectedDraftRevision: revision, zones: rows.map(({ latitude, longitude }) => ({
      latitude: Number(latitude), longitude: Number(longitude), radiusMeters: CAPTURE_ZONE_RADIUS_METERS,
    })) })
  } catch { return null }
}

function ZoneFields({ row, enableMap, onEdit, onRemove }: {
  row: ZoneInput; enableMap: boolean
  onEdit: (field: keyof CaptureZone, value: string) => void; onRemove: () => void
}) {
  const filled = row.latitude.trim() !== '' && row.longitude.trim() !== ''
  const [numericOpen, setNumericOpen] = useState(() => !filled)
  const coordinates = <>
    <label>緯度<input type="number" step="any" value={row.latitude} onChange={(event) => onEdit('latitude', event.target.value)} /></label>
    <label>経度<input type="number" step="any" value={row.longitude} onChange={(event) => onEdit('longitude', event.target.value)} /></label>
  </>
  return <>
    {enableMap
      ? <details open={numericOpen} onToggle={(event) => setNumericOpen(event.currentTarget.open)}>
        <summary>数値で調整</summary>
        {coordinates}
      </details>
      : coordinates}
    <p>{Number(row.radiusMeters) === CAPTURE_ZONE_RADIUS_METERS ? '半径：1,000m（固定）' : `保存済みの半径：${row.radiusMeters}m（旧設定）`}</p>
    <button type="button" onClick={onRemove}>この範囲を外す</button>
  </>
}

function ShootingAreasForm({ api, initial, onReload, enableMap, onContinue }: { api: ApiClient; initial: ManagedShootingAreas; onReload: () => void; enableMap: boolean; onContinue?: () => void }) {
  const [revision, setRevision] = useState(initial.draftRevision)
  const [rows, setRows] = useState(() => toInputs(initial.zones))
  const [selectedIndex, setSelectedIndex] = useState<number | null>(initial.zones.length ? 0 : null)
  const [expandedIndex, setExpandedIndex] = useState<number | null>(initial.zones.length ? 0 : null)
  const [state, setState] = useState<State>('idle')
  const begin = useRequestAction()
  const input = areaInput(rows, revision)
  const legacyRadiusPresent = rows.some((row) => Number(row.radiusMeters) !== CAPTURE_ZONE_RADIUS_METERS)
  const saving = state === 'saving'
  const mapZones = useMemo(() => rows.map((row) => {
    if (fields.some(([field]) => !row[field].trim())) return null
    try {
      const parsed = parseCaptureZones([{ latitude: Number(row.latitude), longitude: Number(row.longitude), radiusMeters: Number(row.radiusMeters) }])
      return parsed[0] ?? null
    } catch { return null }
  }), [rows])

  function edit(next: ZoneInput[]) {
    setRows(next)
    setState((current) => current === 'conflict' ? current : 'idle')
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const advance = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'next'
    if (!input || state === 'conflict') return
    const operation = begin(() => setState('error'))
    if (!operation) return
    setState('saving')
    try {
      const updated = await api.updateShootingAreas(initial.orgId, initial.questId, input, { signal: operation.signal })
      if (!operation.isCurrent()) return
      setRows(toInputs(updated.zones))
      setRevision(updated.draftRevision)
      setState('saved')
      if (advance) onContinue?.()
    } catch (cause) {
      if (operation.isCurrent()) setState(cause instanceof ApiError && cause.code === 'DRAFT_CONFLICT' ? 'conflict' : 'error')
    } finally { operation.finish() }
  }

  return <form onSubmit={save}>
    <p>撮影可能範囲：中心から半径1km（固定）</p>
    <p>下書き版 {revision}。範囲をすべて外して保存すると設定を解除します。</p>
    {enableMap && <><p>対象の所在地ではなく、撮影する人の立ち位置を選びます。地点選択だけでは写真の権利、安全、通行許可の確認は完了しません。</p>
    <label>地図で編集する範囲<select disabled={saving} value={selectedIndex ?? 'new'} onChange={(event) => {
      const next = event.target.value === 'new' ? null : Number(event.target.value)
      setSelectedIndex(next)
      setExpandedIndex(next)
    }}>
      {rows.map((_, index) => <option key={index} value={index}>撮影範囲 {index + 1}</option>)}
      <option value="new" disabled={rows.length >= 10}>新しい範囲</option>
    </select></label>
    <p>地図を押すと、選択中の範囲の中心を移動します。各範囲の半径は1,000mです。</p>
    <ShootingAreasMap zones={mapZones} selectedIndex={selectedIndex} disabled={saving || (selectedIndex === null && rows.length >= 10)} onSelect={(latitude, longitude) => {
      if (selectedIndex === null) {
        if (rows.length >= 10) return
        setSelectedIndex(rows.length)
        setExpandedIndex(rows.length)
        edit([...rows, { latitude: String(latitude), longitude: String(longitude), radiusMeters: String(CAPTURE_ZONE_RADIUS_METERS) }])
      } else {
        setExpandedIndex(selectedIndex)
        edit(rows.map((row, index) => index === selectedIndex ? { ...row, latitude: String(latitude), longitude: String(longitude) } : row))
      }
    }} />
    </>}
    {rows.length === 0 && <p>設定する範囲はありません。</p>}
    {legacyRadiusPresent && <div role="note"><p>保存済みの半径に旧設定があります。新しい公開には半径1,000mの確認が必要です。</p>
      <button type="button" disabled={saving} onClick={() => {
        edit(rows.map((row) => ({ ...row, radiusMeters: String(CAPTURE_ZONE_RADIUS_METERS) })))
      }}>すべての半径を1,000mに変更</button></div>}
    {rows.map((row, index) => {
      const complete = fields.every(([field]) => row[field].trim() !== '') && Number(row.radiusMeters) === CAPTURE_ZONE_RADIUS_METERS
      return <details key={index} open={expandedIndex === index} onToggle={(event) => { if (event.currentTarget.open) setExpandedIndex(index) }}>
        <summary>撮影範囲 {index + 1}{complete ? '・半径1,000m・設定済み' : '・未設定'}</summary>
        <fieldset disabled={saving}>
          <ZoneFields row={row} enableMap={enableMap}
            onEdit={(field, value) => edit(rows.map((current, item) => item === index ? { ...current, [field]: value } : current))}
            onRemove={() => { edit(rows.filter((_, item) => item !== index)); setSelectedIndex(null); setExpandedIndex(null) }} />
        </fieldset>
      </details>
    })}
    {!input && <p>緯度は±90、経度は±180、撮影範囲の半径は1,000m固定です。旧半径の範囲は、1,000mへの変更を選んでから保存してください。</p>}
    {state === 'saved' && <p role="status">撮影できる範囲（非公開）を保存しました。</p>}
    {state === 'error' && <p role="alert">保存結果を確認できませんでした。通信状況を確認して再試行してください。</p>}
    {state === 'conflict' && <p role="alert">下書きの版が変わりました。入力を控えてから最新版を確認してください。</p>}
    <div className="admin-list-actions">
      <button type="button" disabled={saving || rows.length >= 10} onClick={() => { setSelectedIndex(rows.length); setExpandedIndex(rows.length); edit([...rows, { latitude: '', longitude: '', radiusMeters: String(CAPTURE_ZONE_RADIUS_METERS) }]) }}>範囲を追加</button>
      <button type="submit" disabled={saving || !input || state === 'conflict'}>{saving ? '保存しています…' : '撮影範囲を保存'}</button>
      {onContinue && <button type="submit" value="next" className="workflow-primary" disabled={saving || !input || state === 'conflict'}>保存して次へ</button>}
      {state === 'conflict' && <button type="button" className="danger-button" onClick={onReload}>入力を破棄して最新版を確認</button>}
    </div>
  </form>
}

export function ShootingAreasEditor({ api, orgId, questId, onBack, backLabel = '問題一覧へ戻る', enableMap = false, onContinue }: { api: ApiClient; orgId: string; questId: string; onBack: () => void; backLabel?: string; enableMap?: boolean; onContinue?: () => void }) {
  const read = useCallback((signal: AbortSignal) => api.getShootingAreas(orgId, questId, { signal }), [api, orgId, questId])
  const { result, retry } = useRemote(true, read)
  return <section className="form-section" aria-labelledby="shooting-editor-title">
    <h2 id="shooting-editor-title">撮影できる範囲（非公開）</h2>
    <p>撮影の立ち位置を最大10件まで設定できます。旅行者には表示されません。</p>
    <button type="button" onClick={onBack}>{backLabel}</button>
    {result.status === 'loading' && <p role="status">撮影範囲を読み込んでいます…</p>}
    {result.status === 'error' && <><p role="alert">撮影範囲を取得できませんでした。</p><button type="button" onClick={retry}>読み直す</button></>}
    {result.status === 'ready' && <ShootingAreasForm api={api} initial={result.value} onReload={retry} enableMap={enableMap} onContinue={onContinue} />}
  </section>
}
