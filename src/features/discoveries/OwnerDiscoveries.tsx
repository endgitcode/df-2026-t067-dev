import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ApiClient, ApiErrorCode, Discovery } from '../../shared/api'
import { useRemote } from '../../shared/useRemote'
import { DiscoveryDeletion } from './DiscoveryDeletion'

const localDate = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'long', timeZone: 'Asia/Tokyo' })

function RecordDate({ date }: { date: string }) {
  return <time dateTime={date}>{localDate.format(new Date(date))}</time>
}

function ReadFailure({ code, retry }: { code?: ApiErrorCode; retry: () => void }) {
  const message = code === 'NOT_FOUND' ? 'この記録は見つかりませんでした。'
    : code === 'SYSTEM_ERROR' ? '記録を読み込めませんでした。しばらく待ってから、もう一度お試しください。'
      : code === 'UNAUTHENTICATED' ? 'ログインを確認できませんでした。時間をおいて、もう一度お試しください。'
        : '記録を読み込めませんでした。通信状況を確認して、もう一度お試しください。'
  return <>
    <p role="alert">{message}</p>
    <button type="button" className="retry-button" onClick={retry}>記録を読み直す</button>
  </>
}

function RecordPhoto({ blob }: { blob: Blob }) {
  const image = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const target = image.current
    if (!target) return
    const url = URL.createObjectURL(blob)
    target.src = url
    return () => { target.removeAttribute('src'); URL.revokeObjectURL(url) }
  }, [blob])
  return <img ref={image} className="photo-preview" alt="本人の記録写真" />
}

function RecordThumbnail({ api, id, active }: { api: ApiClient; id: string; active: boolean }) {
  const placeholder = useRef<HTMLSpanElement>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    let objectUrl: string | null = null
    let observer: IntersectionObserver | undefined
    const load = () => {
      void api.getDiscoveryPhoto(id, { signal: controller.signal }).then((blob) => {
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setPhotoUrl(objectUrl)
      }).catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    }
    const target = placeholder.current
    if (target && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) return
        observer?.disconnect()
        load()
      }, { rootMargin: '160px' })
      observer.observe(target)
    } else {
      // Older browsers still get thumbnails; they simply load immediately.
      load()
    }
    return () => {
      observer?.disconnect()
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [active, api, id])
  if (photoUrl) return <img className="record-thumbnail" src={photoUrl} alt="" />
  return <span ref={placeholder} className="record-thumbnail-placeholder" aria-hidden="true">{failed ? '写真なし' : '写真を読み込み中'}</span>
}

function RecordGuidance({ record }: { record: Discovery }) {
  const { afterClear, descriptionSnapshot } = record
  const spot = afterClear?.spot
  const fields = ([
    ['アクセス', afterClear?.access.trim()],
    ['利用時間', afterClear?.hours.trim()],
    ['自治体からの紹介', afterClear?.promoComment.trim()],
    ['解説', afterClear?.explanation.trim() || descriptionSnapshot.trim()],
  ] as const).filter(([, value]) => value)

  // 地図リンクは固定の Google Maps 検索URLから組み立てる（D-71）。スポットに
  // 由来する URL を保存・再表示せず、位置と任意の Place ID だけから作る。
  const mapsUrl = spot && 'https://www.google.com/maps/search/?api=1&query='
    + spot.position.latitude + ',' + spot.position.longitude
    + (spot.googlePlaceId ? '&query_place_id=' + encodeURIComponent(spot.googlePlaceId) : '')
  return <>
    {fields.length > 0 && <dl className="record-guidance">
      {fields.map(([label, value]) => <div key={label}>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>)}
    </dl>}
    {mapsUrl && <p className="record-spot-link"><a href={mapsUrl} target="_blank" rel="noreferrer">Google マップを開く</a></p>}
  </>
}

function RecordMetadata({ api, record }: { api: ApiClient; record: Discovery }) {
  const readTitle = useCallback(async (signal: AbortSignal) => (
    await api.getQuest(record.questId, { signal })
  ).title, [api, record.questId])
  const { result } = useRemote(true, readTitle)
  const spot = record.afterClear?.spot
  const title = result.status === 'ready' ? result.value
    : result.status === 'loading' ? '読み込み中…' : '問題名を取得できません'
  return <dl className="record-guidance">
    <div><dt>スポット名</dt><dd>{spot?.name ?? record.placeName}</dd></div>
    <div><dt>日付</dt><dd><RecordDate date={record.firstClearedAt} /></dd></div>
    <div><dt>問題の名前</dt><dd>{title}</dd></div>
    <div><dt>住所</dt><dd>{spot?.address || '住所情報なし'}</dd></div>
  </dl>
}

function DiscoveryDetail({ api, id, onBack, onDeleted }: { api: ApiClient; id: string; onBack: () => void; onDeleted: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    element.showModal()
    return () => element.close()
  }, [])
  const read = useCallback(async (signal: AbortSignal) => {
    const [record, photo] = await Promise.all([
      api.getDiscovery(id, { signal }),
      api.getDiscoveryPhoto(id, { signal }),
    ])
    return { record, photo }
  }, [api, id])
  const { result, retry } = useRemote(true, read)
  return <dialog ref={dialog} aria-labelledby={headingId} className="record-dialog"
    onCancel={(event) => { event.preventDefault(); onBack() }}>
    <div className="record-detail">
      <header className="record-dialog-heading">
        <h2 id={headingId}>記録詳細</h2>
        <button type="button" className="secondary-button" onClick={onBack}>閉じる</button>
      </header>
      {result.status === 'loading' && <p role="status">記録を読み込んでいます…</p>}
      {result.status === 'error' && <ReadFailure code={result.code} retry={retry} />}
      {result.status === 'ready' && <>
        <RecordPhoto blob={result.value.photo} />
        <RecordMetadata api={api} record={result.value.record} />
        <RecordGuidance record={result.value.record} />
        <DiscoveryDeletion api={api} id={id} onDeleted={onDeleted} />
      </>}
    </div>
  </dialog>
}

export function OwnerDiscoveries({ api, initialId, visit = 0, active = true }: { api: ApiClient; initialId?: string; visit?: number; active?: boolean }) {
  const [selected, setSelected] = useState<string | null>(initialId ?? null)
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [deleted, setDeleted] = useState(false)
  const [destination, setDestination] = useState({ initialId, visit })
  // 常駐中の明示遷移を反映する。同じIDでも再訪時は詳細を開き直す。
  if (destination.initialId !== initialId || destination.visit !== visit) {
    setDestination({ initialId, visit })
    setSelected(initialId ?? null)
    if (initialId) setDeleted(false)
  }

  const read = useCallback((signal: AbortSignal) => api.listDiscoveries({ limit: 20, cursor }, { signal }), [api, cursor])
  const { result, retry } = useRemote(true, read)
  // 記録画面は一度開くとアンマウントせず隠して常駐させる（D-53）ため、この部品も
  // 残り続け、初回の取得結果だけが表示され続けてしまう。画面へ入り直すたびに
  // （visit の増加で）一覧を取り直し、初回に空・失敗だった表示が居座ることと、
  // 挑戦で増えた記録が再読み込みなしでは出てこないことを防ぐ。
  const mountedVisit = useRef(visit)
  useEffect(() => {
    if (visit === mountedVisit.current) return
    mountedVisit.current = visit
    retry()
  }, [visit, retry])
  const detail = active && selected !== null && <DiscoveryDetail key={selected} api={api} id={selected} onBack={() => setSelected(null)}
    onDeleted={() => { setDeleted(true); setSelected(null); setCursor(undefined); retry() }} />
  const confirmation = deleted && <p role="status">記録と写真の削除が完了しました。</p>
  if (result.status === 'loading') return <>{detail}{confirmation}<p role="status">記録を読み込んでいます…</p></>
  const firstPage = cursor !== undefined && <button type="button" className="secondary-button" onClick={() => setCursor(undefined)}>最初のページへ</button>
  if (result.status === 'error') return <>{detail}{confirmation}<ReadFailure code={result.code} retry={retry} />{firstPage}</>
  const { items, nextCursor } = result.value
  return <>
    {detail}
    {confirmation}
    {items.length === 0 ? <p>自分の記録はまだありません。</p> : <table className="record-table" aria-label="自分の記録一覧">
      <thead><tr><th scope="col">写真</th><th scope="col">スポット名</th><th scope="col">日付</th></tr></thead>
      <tbody>{items.map((record) => {
        const open = () => { setDeleted(false); setSelected(record.discoveryId) }
        return <tr key={record.discoveryId} onClick={(event) => {
          event.currentTarget.querySelector('button')?.focus()
          open()
        }}>
          <td><RecordThumbnail key={`${record.discoveryId}:${active}`} api={api} id={record.discoveryId} active={active} /></td>
          <td><button type="button" className="record-open" aria-haspopup="dialog" onClick={(event) => { event.stopPropagation(); open() }}>
            {record.afterClear?.spot?.name ?? record.placeName}
          </button></td>
          <td><RecordDate date={record.firstClearedAt} /></td>
        </tr>
      })}</tbody>
    </table>}
    <div className="camera-actions">
      {firstPage}
      {nextCursor && <button type="button" className="secondary-button" onClick={() => setCursor(nextCursor)}>次の記録</button>}
    </div>
  </>
}
