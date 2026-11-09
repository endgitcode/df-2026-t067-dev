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
  const coordinatesRef = useRef<HTMLDetailsElement>(null)
  const request = useRef<AbortController | null>(null)
  const latitudeInvalid = Boolean(input.latitude) && (!Number.isFinite(Number(input.latitude)) || Math.abs(Number(input.latitude)) > 90)
  const longitudeInvalid = Boolean(input.longitude) && (!Number.isFinite(Number(input.longitude)) || Math.abs(Number(input.longitude)) > 180)
  const point = spotPosition(input.latitude, input.longitude)

  useEffect(() => () => request.current?.abort(), [])
  const coordinatesInvalid = latitudeInvalid || longitudeInvalid || (invalid && (!input.latitude.trim() || !input.longitude.trim()))
  useEffect(() => {
    if (coordinatesInvalid && coordinatesRef.current) coordinatesRef.current.open = true
  }, [coordinatesInvalid, input.latitude, input.longitude])

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
    setMessage(details.name || details.address ? '' : '名称・住所の取得失敗')
    request.current = null
  }

  return <fieldset>
    <legend>場所</legend>
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>地図</button>
    {open && <ShootingAreasMap zones={[]} selectedIndex={null} disabled={false} spot={point} pickPlace onSelect={select} />}
    {message && <p role="status">{message}</p>}
    {(candidate.name || candidate.address) && <div className="spot-address-candidate" aria-live="polite">
      <p><strong>候補</strong> <span translate="no">Google Maps</span></p>
      {candidate.name && <p>名称候補：{candidate.name}</p>}
      {candidate.address && <p>住所候補：{candidate.address}</p>}
      <button type="button" onClick={() => edit({ name: candidate.name ?? input.name, address: candidate.address ?? input.address })}>名前・住所を使う</button>
    </div>}
    <label>場所の名前<input aria-describedby={invalid && !input.name.trim() ? "spot-name-error" : undefined} aria-label="場所の名前" value={input.name} maxLength={200} aria-required="true" aria-invalid={invalid && !input.name.trim()}
       placeholder="例：風見の丘公園" onChange={(event) => edit({ name: event.target.value })} /></label>
    {invalid && !input.name.trim() && <p id="spot-name-error" className="field-error">場所の名前を入力</p>}
    <label>住所<input aria-describedby={invalid && !input.address.trim() ? "spot-address-error" : undefined} aria-label="住所" value={input.address} maxLength={1000} aria-required="true" aria-invalid={invalid && !input.address.trim()}
       placeholder="例：青葉みらい市風見1-2-3" onChange={(event) => edit({ address: event.target.value })} /></label>
    {invalid && !input.address.trim() && <p id="spot-address-error" className="field-error">住所を入力</p>}
    <details ref={coordinatesRef} className="spot-coordinates" onToggle={event => {
      if (coordinatesInvalid && !event.currentTarget.open) event.currentTarget.open = true
    }}>
      <summary>緯度・経度</summary>
    <div className="field-pair">
      <label>緯度<input aria-describedby={(latitudeInvalid || (invalid && !input.latitude.trim())) ? "spot-latitude-error" : undefined} inputMode="decimal" aria-label="緯度" value={input.latitude} maxLength={32} aria-required="true" aria-invalid={(latitudeInvalid || (invalid && !input.latitude.trim()))}
        onChange={(event) => edit({ latitude: event.target.value })} /></label>
    {(latitudeInvalid || (invalid && !input.latitude.trim())) && <p id="spot-latitude-error" className="field-error">緯度は-90〜90</p>}
      <label>経度<input aria-describedby={(longitudeInvalid || (invalid && !input.longitude.trim())) ? "spot-longitude-error" : undefined} inputMode="decimal" aria-label="経度" value={input.longitude} maxLength={32} aria-required="true" aria-invalid={(longitudeInvalid || (invalid && !input.longitude.trim()))}
        onChange={(event) => edit({ longitude: event.target.value })} /></label>
    {(longitudeInvalid || (invalid && !input.longitude.trim())) && <p id="spot-longitude-error" className="field-error">経度は-180〜180</p>}
    </div>
    </details>
    {(input.name || input.address || input.latitude || input.longitude) &&
      <button type="button" className="spot-clear-button" onClick={() => {
        cancelLookup()
        setCandidate({})
        setMessage('')
        onChange(initialSpotInput())
      }}>場所を消す</button>}
  </fieldset>
}
