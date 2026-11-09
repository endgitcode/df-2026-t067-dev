import { useEffect, useRef, useState } from 'react'
import type { SpotAddressInput, SpotAddressLookup } from '../../shared/api/admin-spot-address'
import { initialSpotInput, spotPosition } from './mapsSpotLink'
import type { SpotInput } from './mapsSpotLink'
import { ShootingAreasMap } from './ShootingAreasMap'
import type { MapPlaceDetails } from './ShootingAreasMap'

type Lookup = (orgId: string, input: SpotAddressInput, call: { signal: AbortSignal }) => Promise<SpotAddressLookup>

export function MapSpotEditor({ input, invalid, orgId, lookup, onChange }: {
  input: SpotInput; invalid: boolean; orgId: string; lookup?: Lookup; onChange: (input: SpotInput) => void
}) {
  const [open, setOpen] = useState(false)
  const [candidate, setCandidate] = useState<MapPlaceDetails>({})
  const [message, setMessage] = useState('')
  const request = useRef<AbortController | null>(null)
  const latitudeInvalid = Boolean(input.latitude) && (!Number.isFinite(Number(input.latitude)) || Math.abs(Number(input.latitude)) > 90)
  const longitudeInvalid = Boolean(input.longitude) && (!Number.isFinite(Number(input.longitude)) || Math.abs(Number(input.longitude)) > 180)
  const point = spotPosition(input.latitude, input.longitude)

  useEffect(() => () => request.current?.abort(), [])

  function cancelLookup() {
    request.current?.abort()
    request.current = null
  }

  function edit(changes: Partial<SpotInput>) {
    if ('latitude' in changes || 'longitude' in changes) {
      cancelLookup()
      setCandidate({})
      setMessage('')
    }
    onChange({ ...input, ...changes, ...('latitude' in changes || 'longitude' in changes ? { googlePlaceId: undefined } : {}) })
  }

  async function select(latitude: number, longitude: number, place?: { id: string; loadDetails?: () => Promise<MapPlaceDetails> }) {
    cancelLookup()
    setCandidate({})
    const position = { latitude, longitude }
    onChange({ ...initialSpotInput(), latitude: String(latitude), longitude: String(longitude), googlePlaceId: place?.id })
    const controller = new AbortController()
    request.current = controller
    setMessage('地図の場所情報を取得しています…')
    let details: MapPlaceDetails = {}
    try {
      if (place?.loadDetails) details = await place.loadDetails().catch(() => ({}))
      if (controller.signal.aborted) return
      if (!details.address && lookup) {
        const result = await lookup(orgId, { position, ...(place ? { googlePlaceId: place.id } : {}) }, { signal: controller.signal })
        if (result.orgId === orgId && result.status === 'candidate') details = { ...details, address: result.address }
      }
    } catch {
      // The selected coordinates remain available when the lookup fails.
    }
    if (controller.signal.aborted) return
    setCandidate(details)
    setMessage(details.name || details.address ? '' : '地図から名称・住所の候補を取得できませんでした。')
    request.current = null
  }

  return <fieldset>
    <legend>対象スポットの位置・住所</legend>
    <p>必須。保存した位置を中心に、半径1kmの撮影範囲を設定します。</p>
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '地図を閉じる' : '地図を開いて場所を選ぶ'}</button>
    {open && <ShootingAreasMap zones={[]} selectedIndex={null} disabled={false} spot={point} pickPlace onSelect={select} />}
    {message && <p role="status">{message}</p>}
    {(candidate.name || candidate.address) && <div className="spot-address-candidate" aria-live="polite">
      <p><strong>地図の候補（参考）</strong> <span translate="no">Google Maps</span></p>
      {candidate.name && <p>名称候補：{candidate.name}</p>}
      {candidate.address && <p>住所候補：{candidate.address}</p>}
    </div>}
    <p id="spot-registration-help" className="helper">保存する名称と住所は、自治体で確認した情報を下の欄に入力してください。</p>
    <label>スポット名・施設名<small className="required-mark">必須</small><input aria-describedby={invalid && !input.name.trim() ? "spot-name-error" : undefined} aria-label="スポット名・施設名" value={input.name} maxLength={200} aria-required="true" aria-invalid={invalid && !input.name.trim()}
       placeholder="自治体の名称を入力" onChange={(event) => edit({ name: event.target.value })} /></label>
    {invalid && !input.name.trim() && <p id="spot-name-error" className="field-error">スポット名・施設名を入力してください。</p>}
    <label>確認済み住所<small className="required-mark">必須</small><input aria-describedby={invalid && !input.address.trim() ? "spot-address-error" : undefined} aria-label="確認済み住所" value={input.address} maxLength={1000} aria-required="true" aria-invalid={invalid && !input.address.trim()}
       placeholder="自治体の住所を入力" onChange={(event) => edit({ address: event.target.value })} /></label>
    {invalid && !input.address.trim() && <p id="spot-address-error" className="field-error">確認済み住所を入力してください。</p>}
    <div className="field-pair">
      <label>スポットの緯度<small className="required-mark">必須</small><input aria-describedby={(latitudeInvalid || (invalid && !input.latitude.trim())) ? "spot-latitude-error" : undefined} inputMode="decimal" aria-label="スポットの緯度" value={input.latitude} maxLength={32} aria-required="true" aria-invalid={(latitudeInvalid || (invalid && !input.latitude.trim()))}
        onChange={(event) => edit({ latitude: event.target.value })} /></label>
    {(latitudeInvalid || (invalid && !input.latitude.trim())) && <p id="spot-latitude-error" className="field-error">緯度は-90〜90の数値で入力してください。</p>}
      <label>スポットの経度<small className="required-mark">必須</small><input aria-describedby={(longitudeInvalid || (invalid && !input.longitude.trim())) ? "spot-longitude-error" : undefined} inputMode="decimal" aria-label="スポットの経度" value={input.longitude} maxLength={32} aria-required="true" aria-invalid={(longitudeInvalid || (invalid && !input.longitude.trim()))}
        onChange={(event) => edit({ longitude: event.target.value })} /></label>
    {(longitudeInvalid || (invalid && !input.longitude.trim())) && <p id="spot-longitude-error" className="field-error">経度は-180〜180の数値で入力してください。</p>}
    </div>
    {(input.name || input.address || input.latitude || input.longitude) &&
      <button type="button" className="spot-clear-button" onClick={() => {
        cancelLookup()
        setCandidate({})
        setMessage('')
        onChange(initialSpotInput())
      }}>スポットの入力を消す</button>}
  </fieldset>
}
