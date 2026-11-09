import { ShootingAreasMap } from './ShootingAreasMap'
import { initialSpotInput, parseDurableMapsLink, parseMapsSpotLink, spotPosition, type DurableMapsLink, type SpotInput } from './mapsSpotLink'
import { useState } from 'react'

export function SpotEditor({ input, onChange, durable = false }: { input: SpotInput; onChange(input: SpotInput): void; durable?: boolean }) {
  const [message, setMessage] = useState('')
  const [showMap, setShowMap] = useState(false)
  const [reference, setReference] = useState<DurableMapsLink | null>(null)
  const point = spotPosition(input.latitude, input.longitude)
  const referencePosition = reference?.kind === 'place' ? reference.position : null

  function readLink() {
    if (durable) {
      const link = parseDurableMapsLink(input.url)
      setReference(link)
      if (link.kind === 'invalid' || link.kind === 'unsupported') {
        setMessage(link.kind === 'invalid' ? 'Google MapsのHTTPS共有リンクを入力してください。' : 'このリンクから対象の場所を特定できません。地図または数値で位置を指定してください。')
        return
      }
      const position = link.kind === 'place' && !link.googlePlaceId ? link.position : null
      onChange({ ...initialSpotInput(), url: input.url, hasImportedLink: true,
        ...(position ? { latitude: String(position.latitude), longitude: String(position.longitude) } : {}) })
      if (link.kind === 'short') setMessage('短縮リンクを開き、表示されたURLを貼り直してください。手入力でも登録できます。')
      else if (position) setMessage('座標候補を入力しました。スポット名・住所・位置を確認してください。')
      else setMessage('施設名・住所・位置は、地図や自治体の資料で確認して入力してください。')
      return
    }
    const result = parseMapsSpotLink(input.url)
    setMessage(result.message)
    if (!result.position) return
    edit({ latitude: String(result.position.latitude), longitude: String(result.position.longitude) })
  }

  function edit(changes: Partial<SpotInput>) {
    onChange({ ...input, googlePlaceId: undefined, ...changes })
  }

  return <fieldset>
    <legend>対象スポットの位置・住所</legend>
    <p>クリア後の案内に使います。撮影者の立ち位置は「撮影範囲」で別に設定します。</p>
    <label>Google Maps共有URL<input type="url" value={input.url} maxLength={4096}
      onChange={(event) => {
        const url = event.target.value
        if (durable) { edit({ url }); setReference(null) }
        else onChange({ ...input, url })
        setMessage('')
      }} /></label>
    <button type="button" onClick={readLink}>{durable ? 'リンクから場所を取得' : 'リンクから位置候補を読み取る'}</button>
    {message && <p role="status">{message}</p>}
    {reference?.kind === 'short' && <a href={reference.href} target="_blank" rel="noreferrer">Google Mapsで短縮リンクを開く（新しいタブ）</a>}
    {reference?.kind === 'place' && reference.label && <p>リンク内の名称候補：{reference.label}</p>}
    {reference?.kind === 'place' && reference.googlePlaceId && <>
      <p>Place ID候補：<code>{reference.googlePlaceId}</code>。場所との対応は未確認です。</p>
      {referencePosition && <button type="button" onClick={() => {
        const { latitude, longitude } = referencePosition
        edit({ latitude: String(latitude), longitude: String(longitude) })
      }}>リンクの座標候補を使う（Place IDは保存しない）</button>}
    </>}
    {input.googlePlaceId && <p>Google Mapsの場所IDを登録済み</p>}
    <label>スポット名・施設名<input value={input.name} maxLength={200}
      onChange={(event) => edit({ name: event.target.value })} /></label>
    <label>確認済み住所<input value={input.address} maxLength={1000}
      onChange={(event) => edit({ address: event.target.value })} /></label>
    <div className="field-pair">
      <label>スポットの緯度<input inputMode="decimal" value={input.latitude} maxLength={32}
        onChange={(event) => edit({ latitude: event.target.value })} /></label>
      <label>スポットの経度<input inputMode="decimal" value={input.longitude} maxLength={32}
        onChange={(event) => edit({ longitude: event.target.value })} /></label>
    </div>
    <button type="button" aria-expanded={showMap} onClick={() => setShowMap(!showMap)}>{showMap ? '確認地図を閉じる' : '確認地図を開く'}</button>
    {showMap && <ShootingAreasMap zones={[]} selectedIndex={null} disabled={false} spot={point}
      onSelect={(latitude, longitude) => edit({ latitude: String(latitude), longitude: String(longitude) })} />}
    {(input.name || input.address || input.latitude || input.longitude || input.googlePlaceId || (durable && input.url)) &&
      <button type="button" onClick={() => { onChange(initialSpotInput()); setReference(null); setMessage('') }}>スポットの入力を消す</button>}
  </fieldset>
}
